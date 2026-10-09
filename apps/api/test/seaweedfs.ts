import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { GenericContainer, Wait } from 'testcontainers';

const ACCESS_KEY = 'taskop-test';
const SECRET_KEY = 'taskop-test-secret';
const BUCKET = 'taskop-media';
const S3_JSON = JSON.stringify({
  identities: [{ name: 'taskop', credentials: [{ accessKey: ACCESS_KEY, secretKey: SECRET_KEY }], actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'] }],
});

export interface Seaweed {
  /** The S3_* overrides for createTestApp / testEnv. */
  env: Record<string, string>;
  stop: () => Promise<void>;
}

/** One SeaweedFS (master + volume + filer + S3 gateway) with the private bucket created. Only storage tests use it. */
export async function startSeaweedfs(): Promise<Seaweed> {
  const container = await new GenericContainer('chrislusf/seaweedfs:latest')
    .withCopyContentToContainer([{ content: S3_JSON, target: '/etc/seaweedfs/s3.json' }])
    .withCommand(['server', '-s3', '-s3.config=/etc/seaweedfs/s3.json', '-dir=/data'])
    .withExposedPorts(8333)
    .withWaitStrategy(Wait.forListeningPorts())
    .withStartupTimeout(120_000)
    .start();
  const endpoint = `http://${container.getHost()}:${container.getMappedPort(8333)}`;
  const s3 = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY } });
  // The S3 port opens before the master and volume server are ready: retry until the bucket exists.
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
      break;
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'BucketAlreadyOwnedByYou' || name === 'BucketAlreadyExists') break;
      if (Date.now() > deadline) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  s3.destroy();
  return {
    env: { S3_ENDPOINT: endpoint, S3_PUBLIC_ENDPOINT: endpoint, S3_BUCKET: BUCKET, S3_ACCESS_KEY: ACCESS_KEY, S3_SECRET_KEY: SECRET_KEY, S3_FORCE_PATH_STYLE: 'true' },
    stop: async () => {
      await container.stop();
    },
  };
}
