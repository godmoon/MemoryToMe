/* 轻量 API 客户端 */

async function request(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body !== undefined && !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(path, {
        ...options,
        headers,
        body:
            options.body !== undefined && !(options.body instanceof FormData)
                ? JSON.stringify(options.body)
                : options.body,
    });
    const text = await response.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }
    }
    if (!response.ok) {
        const error = new Error((data && data.error) || `请求失败（${response.status}）`);
        error.status = response.status;
        error.data = data;
        throw error;
    }
    return data;
}

export const api = {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: 'POST', body }),
    patch: (path, body) => request(path, { method: 'PATCH', body }),
    delete: (path) => request(path, { method: 'DELETE' }),
};
