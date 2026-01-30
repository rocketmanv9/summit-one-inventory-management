import { redirect } from 'next/navigation';

export default function Home() {
  const coreUrl = process.env.NEXT_PUBLIC_CORE_URL || 'https://dev.summit-one.app';
  redirect(`${coreUrl}/dashboard`);
}
