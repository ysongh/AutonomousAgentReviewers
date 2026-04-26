const { Octokit } = require('@octokit/rest');

let octokit;
function getOctokit() {
  if (!octokit) {
    octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN || undefined,
      userAgent: 'aar-intake/0.1',
    });
  }
  return octokit;
}

function parseRepoUrl(url) {
  const m = url.match(/github\.com[:/]+([^/]+)\/([^/#?.]+?)(?:\.git)?\/?$/i);
  if (!m) throw new Error(`Not a GitHub repo URL: ${url}`);
  return { owner: m[1], repo: m[2] };
}

async function fetchRepoMetadata(repoUrl) {
  const { owner, repo } = parseRepoUrl(repoUrl);
  const gh = getOctokit();

  const { data: repoInfo } = await gh.repos.get({ owner, repo });

  let readme = '';
  try {
    const { data: readmeData } = await gh.repos.getReadme({
      owner,
      repo,
      mediaType: { format: 'raw' },
    });
    readme = typeof readmeData === 'string' ? readmeData : '';
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  const { data: tree } = await gh.repos.getContent({ owner, repo, path: '' });
  const fileTree = Array.isArray(tree)
    ? tree.map((entry) => (entry.type === 'dir' ? `${entry.name}/` : entry.name))
    : [];

  return {
    repoName: repoInfo.full_name,
    repoDescription: repoInfo.description,
    readme,
    fileTree,
  };
}

module.exports = { fetchRepoMetadata, parseRepoUrl };
