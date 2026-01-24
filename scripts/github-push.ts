// GitHub Push Script - Uses Replit GitHub connector
import { Octokit } from '@octokit/rest';
import { execSync } from 'child_process';

let connectionSettings: any;

async function getAccessToken() {
  if (connectionSettings && connectionSettings.settings.expires_at && new Date(connectionSettings.settings.expires_at).getTime() > Date.now()) {
    return connectionSettings.settings.access_token;
  }
  
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=github',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  const accessToken = connectionSettings?.settings?.access_token || connectionSettings?.settings?.oauth?.credentials?.access_token;

  if (!connectionSettings || !accessToken) {
    throw new Error('GitHub not connected');
  }
  return accessToken;
}

async function pushToGitHub() {
  try {
    console.log('🔑 Getting GitHub access token...');
    const token = await getAccessToken();
    
    // Get username from GitHub API
    const octokit = new Octokit({ auth: token });
    const { data: user } = await octokit.users.getAuthenticated();
    console.log(`👤 Authenticated as: ${user.login}`);
    
    // Update remote URL with token
    const repoUrl = `https://${user.login}:${token}@github.com/annex561/LoadMailer.git`;
    
    console.log('🔧 Updating remote URL...');
    execSync(`git remote set-url origin "${repoUrl}"`, { stdio: 'inherit' });
    
    console.log('📤 Pushing to GitHub...');
    execSync('git push origin main', { stdio: 'inherit' });
    
    // Reset remote URL to hide token
    execSync('git remote set-url origin https://github.com/annex561/LoadMailer.git', { stdio: 'inherit' });
    
    console.log('✅ Successfully pushed to GitHub!');
  } catch (error: any) {
    console.error('❌ Push failed:', error.message);
    // Reset remote URL on error too
    try {
      execSync('git remote set-url origin https://github.com/annex561/LoadMailer.git', { stdio: 'pipe' });
    } catch {}
    process.exit(1);
  }
}

pushToGitHub();
