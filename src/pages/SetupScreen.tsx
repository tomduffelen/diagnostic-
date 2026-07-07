export default function SetupScreen({ missing }: { missing: string[] }) {
  const descriptions: Record<string, { label: string; howTo: string }> = {
    VITE_TOTARA_URL: {
      label: 'Totara site URL',
      howTo: 'The full URL of your Totara site, e.g. https://mysite.totara.com',
    },
    VITE_TOTARA_CLIENT_ID: {
      label: 'Totara OAuth2 client ID',
      howTo: 'Admin → API Clients → Add client → copy the client_id',
    },
    VITE_TOTARA_CLIENT_SECRET: {
      label: 'Totara OAuth2 client secret',
      howTo: 'Admin → API Clients → Add client → copy the client_secret',
    },
    VITE_ANTHROPIC_API_KEY: {
      label: 'Anthropic API key',
      howTo: 'console.anthropic.com → API Keys → Create key',
    },
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-lg w-full">
        <div className="text-4xl mb-4">🧭</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Setup required</h1>
        <p className="text-gray-500 mb-6">
          The following environment variables are missing from your{' '}
          <code className="bg-gray-100 px-1 rounded text-sm">.env.local</code> file.
        </p>

        <div className="space-y-4 mb-8">
          {missing.map((key) => {
            const info = descriptions[key]
            return (
              <div key={key} className="border border-red-200 bg-red-50 rounded-lg p-4">
                <div className="font-mono text-sm font-semibold text-red-700">{key}</div>
                {info && (
                  <>
                    <div className="text-sm text-gray-700 mt-1">{info.label}</div>
                    <div className="text-xs text-gray-500 mt-1">{info.howTo}</div>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="bg-gray-50 rounded-lg p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Create a .env.local file in the project root:</p>
          <pre className="text-xs text-gray-600 font-mono whitespace-pre-wrap">
{`VITE_TOTARA_URL=https://your-totara-site.com
VITE_TOTARA_CLIENT_ID=your-client-id
VITE_TOTARA_CLIENT_SECRET=your-client-secret
VITE_ANTHROPIC_API_KEY=your-anthropic-key`}
          </pre>
          <p className="text-xs text-gray-400 mt-2">
            Then restart the dev server with{' '}
            <code className="bg-gray-200 px-1 rounded">npm run dev</code>
          </p>
        </div>
      </div>
    </div>
  )
}
