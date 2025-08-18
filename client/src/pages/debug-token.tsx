import { useState, useEffect } from "react";

export default function DebugToken() {
  const [tokenInfo, setTokenInfo] = useState({
    fullUrl: '',
    pathname: '',
    search: '',
    token: null,
    regexMatch: null,
  });

  useEffect(() => {
    const fullUrl = window.location.href;
    const pathname = window.location.pathname;
    const search = window.location.search;
    
    // Try regex extraction
    const regexMatch = fullUrl.match(/[?&]token=([^&]+)/);
    const token = regexMatch ? decodeURIComponent(regexMatch[1]) : null;
    
    setTokenInfo({
      fullUrl,
      pathname,
      search,
      token,
      regexMatch: regexMatch ? regexMatch[0] : null,
    });
  }, []);

  return (
    <div className="p-8 bg-white">
      <h1 className="text-2xl font-bold mb-6">Token Debug Page</h1>
      
      <div className="space-y-4">
        <div>
          <strong>Full URL:</strong>
          <pre className="bg-gray-100 p-2 mt-1 text-sm">{tokenInfo.fullUrl}</pre>
        </div>
        
        <div>
          <strong>Pathname:</strong>
          <pre className="bg-gray-100 p-2 mt-1 text-sm">{tokenInfo.pathname}</pre>
        </div>
        
        <div>
          <strong>Search:</strong>
          <pre className="bg-gray-100 p-2 mt-1 text-sm">{tokenInfo.search || 'Empty'}</pre>
        </div>
        
        <div>
          <strong>Regex Match:</strong>
          <pre className="bg-gray-100 p-2 mt-1 text-sm">{tokenInfo.regexMatch || 'No match'}</pre>
        </div>
        
        <div>
          <strong>Extracted Token:</strong>
          <pre className="bg-gray-100 p-2 mt-1 text-sm text-green-600">
            {tokenInfo.token || 'NOT FOUND'}
          </pre>
        </div>
      </div>
    </div>
  );
}