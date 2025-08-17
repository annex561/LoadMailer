import { useEffect, useState } from 'react';

export default function TokenTest() {
  const [tokenInfo, setTokenInfo] = useState({
    url: '',
    search: '',
    token: null,
    fullUrl: ''
  });

  useEffect(() => {
    const fullUrl = window.location.href;
    const urlObj = new URL(fullUrl);
    const token = urlObj.searchParams.get('token');
    
    setTokenInfo({
      url: window.location.pathname,
      search: window.location.search,
      token: token,
      fullUrl: fullUrl
    });
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Token Test Page</h1>
      <div className="space-y-2">
        <p><strong>Full URL:</strong> {tokenInfo.fullUrl}</p>
        <p><strong>Pathname:</strong> {tokenInfo.url}</p>
        <p><strong>Search:</strong> {tokenInfo.search}</p>
        <p><strong>Token:</strong> {tokenInfo.token || 'Not found'}</p>
      </div>
    </div>
  );
}