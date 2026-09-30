"""Trusted control SuperNode relay using ordinary Flower request/reply messages."""
from __future__ import annotations

import json
import re
from urllib import request
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

from flwr.app import ConfigRecord, Message, RecordDict

from services.remote_protocol import SignedBridge

MAX_BODY = 2 * 1024 * 1024


class GridBridge(SignedBridge):
    def __init__(self, grid, node_id: int, mission_id: str, run_id: str):
        # This origin is a signing-path placeholder; it is never contacted.
        super().__init__('https://flower-control.invalid', mission_id, run_id)
        self.grid, self.node_id = grid, node_id

    def post(self, action: str, value: dict) -> dict:
        path, data, headers = self.envelope(action, value)
        timeout = 120 if action == 'session' else 30
        msg = Message(RecordDict({'control': ConfigRecord({
            'path': path, 'body': data, 'headers': json.dumps(headers),
        })}), dst_node_id=self.node_id, message_type='query.control', ttl=timeout)
        replies = list(self.grid.send_and_receive([msg], timeout=timeout))
        if not replies:
            raise URLError('Control SuperNode did not reply')
        reply = replies[0]
        if reply.has_error():
            raise URLError('Control SuperNode could not process the request')
        if reply.metadata.src_node_id != self.node_id:
            raise URLError('Unexpected control reply source')
        result = reply.content['control']
        status = int(result['status'])
        if status != 200:
            raise HTTPError(self.url + path, status, 'Control relay rejected request', {}, None)
        return json.loads(result['body'])


def relay_control(msg, context):
    if context.node_config.get('constellation-control') is not True:
        raise ValueError('This SuperNode is not a trusted control node')
    origin = str(context.node_config.get('constellation-api', 'http://127.0.0.1:8011'))
    parts = urlsplit(origin)
    if (parts.scheme != 'http' or parts.hostname not in ('127.0.0.1', '::1')
            or parts.username or parts.password or parts.query or parts.fragment
            or parts.path not in ('', '/')):
        raise ValueError('Control API must be a loopback HTTP origin')
    value = msg.content['control']
    path, body = value['path'], value['body']
    if not isinstance(path, str) or not re.fullmatch(r'/internal/supergrid/m-[a-zA-Z0-9_-]+/(session|sync)', path):
        raise ValueError('Invalid control path')
    if not isinstance(body, bytes) or len(body) > MAX_BODY:
        raise ValueError('Invalid control body')
    supplied = json.loads(value['headers'])
    headers = {k: supplied[k] for k in ('Content-Type', 'X-Constellation-Time',
               'X-Constellation-Nonce', 'X-Constellation-Signature')}
    req = request.Request(origin.rstrip('/') + path, data=body, headers=headers, method='POST')
    # A loopback relay never uses an environment HTTP proxy or follows redirects.
    class NoRedirect(request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    opener = request.build_opener(request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(req, timeout=10) as response:
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                raise ValueError('Control response is too large')
            status = response.status
    except HTTPError as exc:
        status, raw = exc.code, b'{}'
    except (URLError, TimeoutError):
        status, raw = 503, b'{}'
    return Message(RecordDict({'control': ConfigRecord({
        'status': status, 'body': raw.decode(),
    })}), reply_to=msg)
