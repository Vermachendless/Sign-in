import React, { useState, useEffect } from 'react';
import { Wifi, ShieldCheck, AlertCircle, RefreshCw, Server, ArrowRight } from 'lucide-react';

interface NetworkDiagData {
  status: string;
  environment: string;
  networkVerification: {
    isOfficeNetwork: boolean;
    maskedDetectedIp: string;
    verificationMethod: string;
    matchedSource: string | null;
  };
  proxyEvaluation: {
    trustProxyEnabled: boolean;
    proxyHeadersDetected: boolean;
    forwardedHopsCount: number;
  };
  ipResolutionDocumentation: {
    resolutionOrder: string[];
    multipleIpsSupported: boolean;
    multipleIpsFormat: string;
  };
  timestamp: string;
}

export const NetworkDiagnosticCard: React.FC = () => {
  const [data, setData] = useState<NetworkDiagData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchDiagnostic = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/dev/network-diagnostic');
      if (!res.ok) {
        throw new Error(`Diagnostic unavailable (${res.status})`);
      }
      const json = await res.json();
      if (json.success && json.data?.diagnostic) {
        setData(json.data.diagnostic);
      } else {
        throw new Error('Invalid diagnostic response structure');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch network diagnostic');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDiagnostic();
  }, []);

  return (
    <div className="bg-white rounded-2xl border border-brand-border p-6 shadow-xs mt-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded-lg bg-neutral-900 text-brand-yellow">
            <Wifi className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-brand-black flex items-center gap-2">
              Network Verification Diagnostic
              <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded-md bg-neutral-900 text-brand-yellow border border-brand-yellow/30">
                Dev Only
              </span>
            </h3>
            <p className="text-xs text-brand-muted">
              Evaluates incoming client IP against configured office networks via reverse proxy.
            </p>
          </div>
        </div>

        <button
          id="refresh-network-diag-btn"
          onClick={fetchDiagnostic}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-brand-black bg-brand-bg hover:bg-neutral-200/80 border border-brand-border rounded-lg transition disabled:opacity-50 cursor-pointer self-start sm:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-brand-yellow' : ''}`} />
          {loading ? 'Checking...' : 'Re-verify IP'}
        </button>
      </div>

      {error ? (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-xs text-rose-800 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{error}</span>
        </div>
      ) : data ? (
        <div className="space-y-4">
          {/* Main Status Banner */}
          <div
            className={`p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              data.networkVerification.isOfficeNetwork
                ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                : 'bg-amber-50/80 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center gap-3">
              {data.networkVerification.isOfficeNetwork ? (
                <ShieldCheck className="w-6 h-6 text-emerald-600 shrink-0" />
              ) : (
                <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
              )}
              <div>
                <div className="font-bold text-sm flex items-center gap-2">
                  {data.networkVerification.isOfficeNetwork ? 'Approved Office Network' : 'Off-Network Connection Detected'}
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                      data.networkVerification.isOfficeNetwork
                        ? 'bg-emerald-200 text-emerald-900'
                        : 'bg-amber-200 text-amber-900'
                    }`}
                  >
                    {data.networkVerification.isOfficeNetwork ? 'MATCHED' : 'NOT MATCHED'}
                  </span>
                </div>
                <p className="text-xs opacity-90 mt-0.5">
                  Detected Client IP: <span className="font-mono font-bold">{data.networkVerification.maskedDetectedIp}</span> (Masked for privacy)
                </p>
              </div>
            </div>

            <div className="text-xs sm:text-right text-brand-muted">
              <span className="font-medium text-brand-black">Method:</span> {data.networkVerification.verificationMethod}
              {data.networkVerification.matchedSource && (
                <span className="block text-[11px] text-brand-muted">Source: {data.networkVerification.matchedSource}</span>
              )}
            </div>
          </div>

          {/* Diagnostic Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border space-y-2">
              <div className="font-semibold text-brand-black flex items-center gap-1.5">
                <Server className="w-4 h-4 text-brand-yellow" /> Reverse Proxy Ingress Evaluation
              </div>
              <div className="text-brand-muted space-y-1">
                <div className="flex justify-between">
                  <span>Trust Proxy Header:</span>
                  <span className="font-mono font-medium text-brand-black">Enabled (`trust proxy: true`)</span>
                </div>
                <div className="flex justify-between">
                  <span>X-Forwarded-For Present:</span>
                  <span className="font-mono font-medium text-brand-black">
                    {data.proxyEvaluation.proxyHeadersDetected ? 'Yes' : 'Direct Socket (No Proxy Headers)'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Detected Proxy Hops:</span>
                  <span className="font-mono font-medium text-brand-black">{data.proxyEvaluation.forwardedHopsCount}</span>
                </div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-brand-bg border border-brand-border space-y-2">
              <div className="font-semibold text-brand-black flex items-center gap-1.5">
                <ArrowRight className="w-4 h-4 text-brand-yellow" /> Resolution Priority &amp; Multi-IP
              </div>
              <ul className="text-brand-muted space-y-1 text-[11px]">
                <li>&bull; <strong className="text-brand-black">1st:</strong> Leftmost IP in <code className="bg-neutral-200 px-1 py-0.5 rounded text-brand-black">X-Forwarded-For</code></li>
                <li>&bull; <strong className="text-brand-black">2nd:</strong> Express <code className="bg-neutral-200 px-1 py-0.5 rounded text-brand-black">req.ip</code></li>
                <li>&bull; <strong className="text-brand-black">3rd:</strong> Socket <code className="bg-neutral-200 px-1 py-0.5 rounded text-brand-black">remoteAddress</code></li>
                <li className="pt-1 text-brand-muted italic">Supports multiple comma-separated IPs via <code className="bg-neutral-200 px-1 py-0.5 rounded text-brand-black">OFFICE_IPS</code></li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
