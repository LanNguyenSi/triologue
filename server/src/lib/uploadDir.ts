import path from 'path';

// The one directory the upload routes write to and the cleanup paths read
// from; attachment rows store `/uploads/<filename>`. src/lib (and dist/lib
// after the build) sits two levels below the server package root, the same
// depth as src/routes and src/services, so this resolves to server/uploads.
export const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
