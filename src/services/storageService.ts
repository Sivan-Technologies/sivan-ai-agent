import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config";
import axios from "axios";
import { info, warn } from "../lib/logger";

// Lazily instantiate the S3 Client for Cloudflare R2 compatibility
let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client {
  if (s3ClientInstance) return s3ClientInstance;

  const accessKeyId = config.storage.r2AccessKeyId;
  const secretAccessKey = config.storage.r2SecretAccessKey;
  const endpoint = config.storage.r2Endpoint;

  if (!accessKeyId || !secretAccessKey || !endpoint) {
    throw new Error("Missing Cloudflare R2 storage credentials in environment settings.");
  }

  s3ClientInstance = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  return s3ClientInstance;
}

/**
 * Downloads a file from an external URL and uploads it to Sivan's R2 Bucket.
 * Returns the unique storage key (e.g. "test/proofs/178280_evidence.pdf").
 */
export async function uploadEvidenceUrlToR2(sourceUrl: string, filename: string): Promise<string> {
  if (config.databaseMode === "test") {
    info("Test database mode: returning mock R2 storage key directly", { sourceUrl, filename });
    return `test/proofs/mock_${Date.now()}_${filename.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
  }

  const client = getS3Client();
  const bucketName = config.storage.r2BucketName;
  
  info("Downloading evidence file from source URL for R2 backup", { sourceUrl, filename });

  // 1. Download file content as a Buffer
  let buffer: Buffer;
  let contentType = "application/octet-stream";
  try {
    const res = await axios.get(sourceUrl, {
      responseType: "arraybuffer",
      timeout: 15000,
      headers: { "User-Agent": "SivanEvidenceDownloader/1.0" },
    });
    buffer = Buffer.from(res.data);
    contentType = String(res.headers["content-type"] || contentType);
  } catch (err: any) {
    warn("Failed to download file from source URL", { sourceUrl, error: err.message });
    throw new Error(`Failed to download evidence file: ${err.message}`);
  }

  // 2. Generate a clean storage key
  const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const mode = config.databaseMode; // "test" or "live"
  const key = `${mode}/proofs/${Date.now()}_${sanitizedFilename}`;

  // 3. Upload to Cloudflare R2
  info("Uploading evidence file buffer to Cloudflare R2", { bucketName, key, contentType, size: buffer.length });
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    info("Successfully uploaded evidence file to Cloudflare R2", { key });
    return key;
  } catch (err: any) {
    warn("Failed to upload evidence to Cloudflare R2", { key, error: err.message });
    throw new Error(`R2 upload failed: ${err.message}`);
  }
}

/**
 * Generates a secure, expiring presigned URL to download a file from R2.
 */
export async function getPresignedDownloadUrl(key: string): Promise<string> {
  if (config.databaseMode === "test") {
    return `https://sivan-mock-presigned-url.test/${key}`;
  }

  const client = getS3Client();
  const bucketName = config.storage.r2BucketName;

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    // Presigned URL expires in 1 hour (3600 seconds)
    return await getSignedUrl(client, command, { expiresIn: 3600 });
  } catch (err: any) {
    warn("Failed to generate presigned download URL", { key, error: err.message });
    throw err;
  }
}
