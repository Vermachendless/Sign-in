import { maskIpAddress, extractClientIp, verifyOfficeNetwork, getApprovedOfficeIps } from './server/services/network.service.ts';
import { Request } from 'express';

async function runNetworkDiagnosticTests() {
  console.log('================================================================');
  console.log('   RUNNING NETWORK VERIFICATION DIAGNOSTIC TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // 1. Test IP Masking
  const maskedIpv4 = maskIpAddress('102.129.144.52');
  assert(maskedIpv4 === '102.129.***.52', `IPv4 masked properly: ${maskedIpv4}`);

  const maskedLocal = maskIpAddress('127.0.0.1');
  assert(maskedLocal === '127.0.***.1', `Loopback IPv4 masked properly: ${maskedLocal}`);

  const maskedIpv6 = maskIpAddress('2a00:1450:4009:820::200e');
  assert(maskedIpv6.includes('****') && maskedIpv6.startsWith('2a00:1450'), `IPv6 masked properly: ${maskedIpv6}`);

  // 2. Test Comma-Separated OFFICE_IPS Environment Variable parsing
  process.env.OFFICE_IPS = '102.129.144.1, 197.210.55.24, 105.112.43.99, 127.0.0.1';
  const { envIps, allIps } = getApprovedOfficeIps();
  assert(envIps.length === 4, `Parsed 4 comma-separated IPs from OFFICE_IPS env var (found ${envIps.length})`);
  assert(allIps.has('102.129.144.1'), 'Contains first office IP');
  assert(allIps.has('197.210.55.24'), 'Contains second office IP');
  assert(allIps.has('105.112.43.99'), 'Contains third office IP');
  assert(allIps.has('127.0.0.1'), 'Contains loopback IP');

  // 3. Test Reverse Proxy Header Extraction (X-Forwarded-For chain)
  const mockReqWithProxy = {
    headers: {
      'x-forwarded-for': '102.129.144.1, 10.0.0.15, 172.17.0.1',
    },
    ip: '10.0.0.15',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;

  const extracted = extractClientIp(mockReqWithProxy);
  assert(extracted.ip === '102.129.144.1', `Extracted leftmost client IP: ${extracted.ip}`);
  assert(extracted.proxyHeadersDetected === true, 'Detected reverse proxy header');
  assert(extracted.proxyHopCount === 3, `Counted 3 proxy hops in chain: ${extracted.proxyHopCount}`);

  // 4. Test Verification: Matching Office IP (Allowed)
  const matchResult = verifyOfficeNetwork(mockReqWithProxy);
  assert(matchResult.isOfficeNetwork === true, 'IP matched approved office list');
  assert(matchResult.maskedDetectedIp === '102.129.***.1', `Masked IP returned in result: ${matchResult.maskedDetectedIp}`);
  assert(matchResult.verificationMethod === 'OFFICE_IP', 'Verification method is OFFICE_IP');
  assert(matchResult.matchedRuleType === 'ENVIRONMENT', 'Matched via ENVIRONMENT rule');

  // 5. Test Verification: Non-Matching IP (Off-Network / Denied)
  const mockReqOffNetwork = {
    headers: {
      'x-forwarded-for': '41.203.110.88, 10.0.0.15',
    },
    ip: '10.0.0.15',
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;

  const nonMatchResult = verifyOfficeNetwork(mockReqOffNetwork);
  assert(nonMatchResult.isOfficeNetwork === false, 'Off-network IP rejected');
  assert(nonMatchResult.maskedDetectedIp === '41.203.***.88', `Masked off-network IP: ${nonMatchResult.maskedDetectedIp}`);
  assert(nonMatchResult.matchedRuleType === 'NONE', 'Rule type is NONE');

  // 6. Test Verification: Second Comma-Separated IP in list (197.210.55.24)
  const mockReqSecondIp = {
    headers: {
      'x-forwarded-for': '197.210.55.24',
    },
  } as unknown as Request;
  const secondResult = verifyOfficeNetwork(mockReqSecondIp);
  assert(secondResult.isOfficeNetwork === true, 'Second comma-separated IP successfully recognized as office network');

  // 7. Test HTTP Endpoint Live (Testing HTTP GET /api/dev/network-diagnostic)
  const base = 'http://127.0.0.1:3000';
  const response = await fetch(`${base}/api/dev/network-diagnostic`, {
    headers: {
      'X-Forwarded-For': '102.129.144.1, 10.0.0.1',
    },
  });

  assert(response.status === 200, `Dev endpoint returns 200 OK (got ${response.status})`);
  const body = (await response.json()) as {
    success: boolean;
    data: {
      diagnostic: {
        networkVerification: {
          isOfficeNetwork: boolean;
          maskedDetectedIp: string;
          verificationMethod: string;
        };
        proxyEvaluation: {
          proxyHeadersDetected: boolean;
          forwardedHopsCount: number;
        };
        ipResolutionDocumentation: {
          resolutionOrder: string[];
          multipleIpsSupported: boolean;
        };
      };
    };
  };

  assert(body.success === true, 'Response format conforms to standard ApiResponse');
  assert(body.data.diagnostic.networkVerification.isOfficeNetwork === true, 'Diagnostic correctly validates office IP');
  assert(body.data.diagnostic.networkVerification.maskedDetectedIp === '102.129.***.1', 'Detected IP is masked');
  assert(body.data.diagnostic.networkVerification.verificationMethod === 'OFFICE_IP', 'Verification method is OFFICE_IP');
  assert(body.data.diagnostic.proxyEvaluation.proxyHeadersDetected === true, 'Proxy headers detected in HTTP test');
  assert(body.data.diagnostic.ipResolutionDocumentation.multipleIpsSupported === true, 'Documents multiple comma-separated IPs support');

  // 8. Verify Zero Sensitive Leakage
  const rawBodyText = JSON.stringify(body);
  assert(!rawBodyText.includes('197.210.55.24'), 'Does not leak other configured office IPs');
  assert(!rawBodyText.includes('105.112.43.99'), 'Does not leak full office IP list in response');
  assert(!rawBodyText.includes('password') && !rawBodyText.includes('secret'), 'Does not leak any secrets');

  console.log('\n================================================================');
  console.log(`NETWORK DIAGNOSTIC TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runNetworkDiagnosticTests().catch((err) => {
  console.error('Fatal error during network diagnostic test run:', err);
  process.exit(1);
});
