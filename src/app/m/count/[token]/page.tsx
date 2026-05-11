import { MobileCountClient } from './MobileCountClient';

export default function MobileCountPage() {
  const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET || '';
  return <MobileCountClient bypassSecret={bypassSecret} />;
}
