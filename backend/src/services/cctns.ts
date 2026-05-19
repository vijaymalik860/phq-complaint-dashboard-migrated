import crypto from 'crypto';

interface CctnsToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CctnsToken | null = null;

const ALGORITHM = 'aes-256-cbc';

function decrypt(encryptedData: string, key: string): string {
  try {
    const buffer = Buffer.from(encryptedData, 'base64');
    const iv = buffer.slice(0, 16);
    const encrypted = buffer.slice(16);
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(key.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decrypt error:', error);
    return encryptedData;
  }
}

export async function getCctnsToken(): Promise<string> {
  const secretKey = process.env.CCTNS_SECRET_KEY;
  const tokenApi = process.env.CCTNS_TOKEN_API;

  if (!secretKey || !tokenApi) {
    throw new Error('CCTNS_SECRET_KEY or CCTNS_TOKEN_API not configured');
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.token;
  }

  const url = `${tokenApi}?SecretKey=${encodeURIComponent(secretKey)}`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'Accept': 'application/json, text/plain, */*' },
    });
  } catch (err) {
    throw new Error(`Cannot reach CCTNS Token API: ${err instanceof Error ? err.message : err}`);
  }

  if (!res.ok) {
    throw new Error(`Token API HTTP error: ${res.status} ${res.statusText}`);
  }

  const rawText = await res.text();
  console.log('[CCTNS] Raw token API response:', rawText.substring(0, 300));

  let tokenStr = '';

  // API returns .NET WCF XML: <string xmlns="...">TOKEN</string>
  const xmlMatch = rawText.match(/<string[^>]*>([^<]+)<\/string>/i);
  if (xmlMatch && xmlMatch[1]) {
    tokenStr = xmlMatch[1].trim();
  } else {
    try {
      const data = JSON.parse(rawText);
      if (typeof data === 'string') {
        tokenStr = data;
      } else if (data && typeof data === 'object') {
        const token = (
          (data as any).token || (data as any).Token || (data as any).TokenValue ||
          (data as any).AccessToken || (data as any).Result || (data as any).Data
        );
        if (token) tokenStr = typeof token === 'string' ? token : JSON.stringify(token);
      }
    } catch {
      const plain = rawText.trim().replace(/^"|"$/g, '');
      if (plain && !plain.includes('<') && plain.length > 10) tokenStr = plain;
    }
  }

  if (!tokenStr) {
    console.error('[CCTNS] Unrecognised token response:', rawText.substring(0, 200));
    throw new Error(`Could not extract token from API response. Raw: ${rawText.substring(0, 100)}`);
  }

  cachedToken = {
    token: tokenStr,
    expiresAt: Date.now() + 55 * 60 * 1000,
  };

  return tokenStr;
}

export async function fetchCctnsComplaints(timeFrom: string, timeTo: string, dType: 'P' | 'F' = 'P'): Promise<Record<string, unknown>[]> {
  console.log(`[CCTNS] Fetching complaints: ${timeFrom} to ${timeTo} (DType: ${dType})`);
  
  const token = await getCctnsToken();
  const apiUrl = process.env.CCTNS_COMPLAINT_API;
  const decryptKey = process.env.CCTNS_DECRYPT_KEY;

  if (!apiUrl || !decryptKey) {
    throw new Error('CCTNS_COMPLAINT_API or CCTNS_DECRYPT_KEY not configured');
  }

  const url = `${apiUrl}?TimeFrom=${timeFrom}&TimeTo=${timeTo}&DType=${dType}`;
  console.log(`[CCTNS] Request URL: ${url}`);
  
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
    },
    signal: AbortSignal.timeout(300000), // 5 minute timeout for larger sync windows
  });

  if (!res.ok) {
    throw new Error(`Complaint API failed: ${res.status} ${res.statusText}`);
  }

  const responseData = await res.text();
  console.log(`[CCTNS] Response length: ${responseData.length} chars`);

  // Try plain JSON first
  try {
    const parsed = JSON.parse(responseData);
    const records = Array.isArray(parsed) ? parsed : parsed.data || parsed.complaints || [];
    console.log(`[CCTNS] Parsed ${records.length} records from JSON`);
    return records;
  } catch {
    // Fallback: try AES decrypt in case response format changes
    console.log('[CCTNS] JSON parse failed, trying AES decrypt...');
    const decrypted = decrypt(responseData, decryptKey);
    try {
      const parsed = JSON.parse(decrypted);
      const records = Array.isArray(parsed) ? parsed : parsed.data || parsed.complaints || [];
      console.log(`[CCTNS] Parsed ${records.length} records from decrypted JSON`);
      return records;
    } catch {
      console.error('[CCTNS] Failed to parse response as JSON or decrypted JSON');
      console.error('[CCTNS] Raw response preview:', responseData.substring(0, 200));
      return [];
    }
  }
}

// fetchCctnsEnquiries removed — single PHQDashboard endpoint provides all data
// Use fetchCctnsComplaints for both complaint and enquiry data

export function clearCctnsToken(): void {
  cachedToken = null;
}
