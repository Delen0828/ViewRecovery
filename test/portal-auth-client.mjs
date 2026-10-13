export function portalClient(base) {
  const cookies = new Map();
  const api = async (path, options = {}) => {
    const response = await fetch(base + path, {...options, headers: {
      Origin: base,
      ...(cookies.size ? {Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')} : {}),
      ...options.headers
    }});
    for (const cookie of response.headers.getSetCookie()) {
      const [name, ...value] = cookie.split(';')[0].split('=');
      if (value.join('=')) cookies.set(name, value.join('=')); else cookies.delete(name);
    }
    return response;
  };
  const post = (path, body, headers) => api(path, {method: 'POST', headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
  const login = async (username, password = username, mode = 'user') => {
    const response = await post('/data-portal/auth/sign-in/username', {username, password, mode});
    const body = await response.json();
    return {response, body};
  };
  return {api, post, login};
}
