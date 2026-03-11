import { Injectable } from '@nestjs/common';
import {
  GetBucketLocationCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { EnvironmentsService } from '../environments/environments.service';

@Injectable()
export class S3Service {
  constructor(private readonly environmentsService: EnvironmentsService) {}

  private getClient(environmentId: string): S3Client {
    return this.environmentsService.getAwsClients(environmentId).s3;
  }

  async listBuckets(environmentId: string, region: string) {
    const client = this.getClient(environmentId);
    const buckets = await client.send(new ListBucketsCommand({}));
    const list = buckets.Buckets || [];

    const results = await Promise.allSettled(
      list.map(async (bucket) => {
        if (!bucket.Name) return null;
        const res = await client.send(
          new GetBucketLocationCommand({ Bucket: bucket.Name }),
        );
        // us-east-1 returns null/empty
        const bucketRegion = res.LocationConstraint
          ? res.LocationConstraint
          : 'us-east-1';
        if (bucketRegion !== region) return null;
        return bucket.Name;
      }),
    );

    return results
      .filter((r): r is PromiseFulfilledResult<string | null> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter((v): v is string => !!v)
      .sort();
  }

  async objectExists(environmentId: string, bucket: string, key: string) {
    const client = this.getClient(environmentId);
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return true;
    } catch (err: any) {
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw err;
    }
  }

  async uploadObject(
    environmentId: string,
    bucket: string,
    key: string,
    file: { buffer: Buffer; mimetype?: string; originalname?: string },
  ) {
    const client = this.getClient(environmentId);
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
      }),
    );
    return {
      bucket,
      key,
    };
  }
}
