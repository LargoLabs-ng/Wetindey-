import { Suspense } from 'react';
import PaymentCallbackClient from './payment-callback-client';

export default function PaymentCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--color-ivory)' }}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2" style={{ borderColor: 'var(--color-forest)' }}></div>
          <p className="mt-4" style={{ color: 'var(--color-forest)' }}>Loading payment status...</p>
        </div>
      </div>
    }>
      <PaymentCallbackClient />
    </Suspense>
  );
}
