import React, { useState, useEffect } from 'react';

// This component only uses stable React 18 APIs — should be low risk
export default function StableComponent({ userId }: { userId: string }) {
  const [data, setData] = useState<string | null>(null);

  useEffect(() => {
    setData(`Hello ${userId}`);
  }, [userId]);

  return <div>{data}</div>;
}
