import { createContext, useContext } from 'react';

const SocketCtx = createContext(null);

export function useSocketCtx() { return useContext(SocketCtx); }
export default SocketCtx;
