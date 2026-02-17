// API base URL — uses relative paths in production, localhost in development
const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';

export default API_BASE;
