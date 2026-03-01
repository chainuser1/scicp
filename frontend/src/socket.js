import { io } from 'socket.io-client';

// "undefined" means the URL will be computed from the `window.location` object
// use Vite's environment variables instead of process.env
const URL = import.meta.env.MODE === 'production' ? undefined : 'http://localhost:3000';

export const socket = io(URL);
