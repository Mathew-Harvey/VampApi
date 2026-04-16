import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

type CheckStatus = 'PASS' | 'WARN' | 'FAIL';

interface CheckResult {
  status: CheckStatus;
  name: string;
  detail: string;
}

function getConfiguredLocalMediaPath(): string {
  const configPath = path.join(process.cwd(), 'storage-config.json');
  if (fs.existsSync(configPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (typeof parsed?.localMediaPath === 'string' && parsed.localMediaPath.trim()) {
        return path.resolve(parsed.localMediaPath);
      }
    } catch {
      // Fall through to default path.
    }
  }
  return path.join(process.cwd(), 'uploads');
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const results: CheckResult[] = [];

  const localMediaPath = getConfiguredLocalMediaPath();
  const probeFilename = `_vamp_media_probe_${Date.now()}.txt`;
  const probePath = path.join(localMediaPath, probeFilename);
  let createdProbe = false;

  try {
    fs.mkdirSync(localMediaPath, { recursive: true });
    results.push({
      status: 'PASS',
      name: 'Local media directory exists',
      detail: localMediaPath,
    });
  } catch (error: any) {
    results.push({
      status: 'FAIL',
      name: 'Local media directory exists',
      detail: `Could not create/access "${localMediaPath}": ${error.message}`,
    });
  }

  if (!results.some((r) => r.status === 'FAIL')) {
    try {
      fs.writeFileSync(probePath, `probe:${new Date().toISOString()}`);
      createdProbe = true;
      results.push({
        status: 'PASS',
        name: 'Local media directory is writable',
        detail: `Wrote probe file: ${probeFilename}`,
      });
    } catch (error: any) {
      results.push({
        status: 'FAIL',
        name: 'Local media directory is writable',
        detail: `Write test failed for "${localMediaPath}": ${error.message}`,
      });
    }
  }

  const apiBase =
    process.env.API_URL ||
    `http://localhost:${process.env.PORT && process.env.PORT.trim() ? process.env.PORT : '3001'}`;

  let apiReachable = false;
  try {
    const health = await fetchWithTimeout(`${apiBase}/api/v1/health`, 4000);
    apiReachable = health.ok;
    if (health.ok) {
      results.push({
        status: 'PASS',
        name: 'API health endpoint reachable',
        detail: `${apiBase}/api/v1/health responded ${health.status}`,
      });
    } else {
      results.push({
        status: 'WARN',
        name: 'API health endpoint reachable',
        detail: `${apiBase}/api/v1/health responded ${health.status}. Start/restart API and rerun.`,
      });
    }
  } catch (error: any) {
    results.push({
      status: 'WARN',
      name: 'API health endpoint reachable',
      detail: `Could not reach ${apiBase}/api/v1/health: ${error.message}`,
    });
  }

  if (apiReachable && createdProbe) {
    try {
      const uploadUrl = `${apiBase}/uploads/${probeFilename}`;
      const uploadResp = await fetchWithTimeout(uploadUrl, 5000);
      if (uploadResp.ok) {
        results.push({
          status: 'PASS',
          name: 'Uploads static route serves local files',
          detail: `${uploadUrl} responded ${uploadResp.status}`,
        });
      } else {
        results.push({
          status: 'FAIL',
          name: 'Uploads static route serves local files',
          detail: `${uploadUrl} responded ${uploadResp.status}. Check '/uploads' mount and localMediaPath.`,
        });
      }
    } catch (error: any) {
      results.push({
        status: 'FAIL',
        name: 'Uploads static route serves local files',
        detail: `Request failed: ${error.message}`,
      });
    }
  } else if (!apiReachable) {
    results.push({
      status: 'WARN',
      name: 'Uploads static route serves local files',
      detail: 'Skipped because API is not reachable. Start API and rerun to verify end-to-end photo serving.',
    });
  }

  if (createdProbe) {
    try {
      fs.unlinkSync(probePath);
    } catch {
      // Non-fatal cleanup failure.
    }
  }

  console.log('Local Media Startup Verification');
  console.log('================================');
  for (const result of results) {
    console.log(`[${result.status}] ${result.name}`);
    console.log(`       ${result.detail}`);
  }

  const hasFail = results.some((r) => r.status === 'FAIL');
  if (hasFail) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`Fatal verify-local-media error: ${error.message}`);
  process.exit(1);
});
