import { Directory, File, Paths, UploadType } from 'expo-file-system';
import type { MediaTransport } from '../media-queue';

/** Captured media live here (not in the cache, which the OS may clear) until uploaded and 7 days old. */
export function mediaDirectory(): Directory {
  const dir = new Directory(Paths.document, 'media');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export const nativeMediaFiles: MediaTransport = {
  exists: (uri) => new File(uri).exists,
  remove: (uri) => {
    const file = new File(uri);
    if (file.exists) file.delete();
  },
  async upload(uri, url, headers) {
    // The presigned PUT signs Content-Type and Content-Length: send exactly the ticket's headers (Part 1 Task 10).
    const result = await new File(uri).upload(url, { httpMethod: 'PUT', uploadType: UploadType.BINARY_CONTENT, headers });
    return result.status;
  },
};
