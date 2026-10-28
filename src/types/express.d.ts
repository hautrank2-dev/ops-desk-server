import { JwtPayload } from './auth';

declare global {
  interface Request {
    payload?: JwtPayload;
  }
}

// Một số route cần `Request` thật của Express (có `.on`/`.off`...), không
// phải `Request` toàn cục (DOM fetch) ở trên — khai báo thêm ở đây để cả
// hai đều có `.payload`.
declare module 'express' {
  interface Request {
    payload?: JwtPayload;
  }
}
