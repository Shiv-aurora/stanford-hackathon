from fastapi.testclient import TestClient
import httpx
import pytest

import callback_proxy


@pytest.mark.parametrize('path', ['/mission', '/mission/private', '/workers/private/attack', '/docs', '/openapi.json', '/health'])
def test_proxy_does_not_expose_application_routes(path):
    client = TestClient(callback_proxy.app)
    assert client.get(path).status_code == 404
    assert client.post(path, json={}).status_code == 404


def test_proxy_preserves_signed_request(monkeypatch):
    class Client:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            pass
        async def post(self, url, content, headers):
            assert url == 'http://127.0.0.1:8011/internal/supergrid/m-abc/sync'
            assert content == b'{"value": "exact bytes"}'
            assert headers['x-constellation-signature'] == 'signature'
            assert 'authorization' not in headers
            return httpx.Response(403, json={'detail': 'Invalid signature'})
    monkeypatch.setattr(callback_proxy.httpx, 'AsyncClient', lambda **kw: Client())
    response = TestClient(callback_proxy.app).post('/internal/supergrid/m-abc/sync',
        content=b'{"value": "exact bytes"}', headers={'x-constellation-signature': 'signature', 'authorization': 'not-forwarded'})
    assert response.status_code == 403


def test_proxy_rejects_large_body(monkeypatch):
    monkeypatch.setattr(callback_proxy, 'MAX_BODY', 8)
    assert TestClient(callback_proxy.app).post('/internal/supergrid/m-abc/sync', content=b'123456789').status_code == 413
