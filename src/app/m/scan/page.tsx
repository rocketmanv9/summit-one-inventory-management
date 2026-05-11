import { MobileScanClient } from './MobileScanClient';

export default function MobileScanPage() {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  return <MobileScanClient bypassSecret={bypassSecret} />;
}
