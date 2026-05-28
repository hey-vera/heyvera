// Replit workspace project API
import { requestJson } from './cortexApi';

export interface ProjectWorkspace {
  id: string;
  user_id: string;
  project_name: string;
  workspace_id: string;
  workspace_url: string;
  chat_endpoint: string;
  created_at: string;
  updated_at: string;
  status: 'creating' | 'active' | 'error';
  metadata?: {
    language?: string;
    description?: string;
    source_type?: string;
    source_url?: string;
  };
}

export interface ReplitWorkspace {
  id: string;
  title: string;
  language: string;
  url: string;
  is_private: boolean;
  description?: string;
  user_id?: string;
  files: Record<string, string>;
}

export interface CreateProjectRequest {
  title: string;
  language: string;
  description?: string;
  files?: Record<string, string>;
}

export interface ImportProjectRequest {
  name: string;
  source_type: 'github' | 'upload' | 'template';
  source_url?: string;
  files?: Record<string, string>;
}

export interface ProjectWorkspaceResponse {
  project_id: string;
  workspace: ReplitWorkspace;
  chat_endpoint: string;
  access_token?: string;
}

/**
 * Create a new project with Replit workspace
 */
export async function createProject(request: CreateProjectRequest): Promise<ProjectWorkspaceResponse> {
  try {
    return await requestJson<ProjectWorkspaceResponse>('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (error: any) {
    throw new Error(error.message || 'Failed to create project');
  }
}

/**
 * Import a project from GitHub or other source
 */
export async function importProject(request: ImportProjectRequest): Promise<ProjectWorkspaceResponse> {
  try {
    return await requestJson<ProjectWorkspaceResponse>('/api/projects/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (error: any) {
    throw new Error(error.message || 'Failed to import project');
  }
}

/**
 * List all user's project workspaces
 */
export async function listProjects(): Promise<ProjectWorkspace[]> {
  try {
    const response = await requestJson<{ workspaces: ProjectWorkspace[] }>('/api/projects');
    return response.workspaces;
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch projects');
  }
}

/**
 * Get a specific project workspace
 */
export async function getProject(projectId: string): Promise<ProjectWorkspace> {
  try {
    return await requestJson<ProjectWorkspace>(`/api/projects/${encodeURIComponent(projectId)}`);
  } catch (error: any) {
    throw new Error(error.message || 'Failed to fetch project');
  }
}

/**
 * Delete a project workspace
 */
export async function deleteProject(projectId: string): Promise<void> {
  try {
    await requestJson(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'DELETE',
    });
  } catch (error: any) {
    throw new Error(error.message || 'Failed to delete project');
  }
}

/**
 * Send a chat message to a project workspace
 */
export async function chatWithWorkspace(
  projectId: string,
  message: string,
  filePaths?: string[]
): Promise<void> {
  try {
    return await requestJson(`/api/projects/${encodeURIComponent(projectId)}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        file_paths: filePaths || [],
      }),
    });
  } catch (error: any) {
    throw new Error(error.message || 'Failed to send chat message');
  }
}

/**
 * Get available programming languages for projects
 */
export function getAvailableLanguages() {
  return [
    { value: 'javascript', label: 'JavaScript', icon: '🟨' },
    { value: 'typescript', label: 'TypeScript', icon: '🔷' },
    { value: 'python', label: 'Python', icon: '🐍' },
    { value: 'rust', label: 'Rust', icon: '🦀' },
    { value: 'go', label: 'Go', icon: '🐹' },
    { value: 'java', label: 'Java', icon: '☕' },
    { value: 'cpp', label: 'C++', icon: '⚡' },
    { value: 'csharp', label: 'C#', icon: '💜' },
    { value: 'php', label: 'PHP', icon: '🐘' },
    { value: 'ruby', label: 'Ruby', icon: '💎' },
  ];
}

/**
 * Get project template files based on language
 */
export function getTemplateFiles(language: string, projectName: string): Record<string, string> {
  const templates: Record<string, Record<string, string>> = {
    javascript: {
      'package.json': JSON.stringify({
        name: projectName.toLowerCase().replace(/\s+/g, '-'),
        version: '1.0.0',
        description: '',
        main: 'index.js',
        scripts: {
          start: 'node index.js',
          test: 'echo "Error: no test specified" && exit 1'
        },
        keywords: [],
        author: '',
        license: 'ISC'
      }, null, 2),
      'index.js': 'console.log("Hello, World!");',
      'README.md': `# ${projectName}\n\nA new JavaScript project created with Cortex.\n`,
    },
    typescript: {
      'package.json': JSON.stringify({
        name: projectName.toLowerCase().replace(/\s+/g, '-'),
        version: '1.0.0',
        description: '',
        main: 'dist/index.js',
        scripts: {
          build: 'tsc',
          start: 'node dist/index.js',
          dev: 'ts-node src/index.ts'
        },
        devDependencies: {
          typescript: '^5.0.0',
          '@types/node': '^20.0.0',
          'ts-node': '^10.9.0'
        }
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          module: 'commonjs',
          outDir: './dist',
          rootDir: './src',
          strict: true,
          esModuleInterop: true
        }
      }, null, 2),
      'src/index.ts': 'console.log("Hello, World!");',
      'README.md': `# ${projectName}\n\nA new TypeScript project created with Cortex.\n`,
    },
    python: {
      'main.py': 'print("Hello, World!")',
      'requirements.txt': '',
      'README.md': `# ${projectName}\n\nA new Python project created with Cortex.\n`,
    },
    rust: {
      'Cargo.toml': `[package]\nname = "${projectName.toLowerCase().replace(/\s+/g, '_')}"\nversion = "0.1.0"\nedition = "2021"\n\n[dependencies]\n`,
      'src/main.rs': 'fn main() {\n    println!("Hello, World!");\n}',
      'README.md': `# ${projectName}\n\nA new Rust project created with Cortex.\n`,
    },
    go: {
      'go.mod': `module ${projectName.toLowerCase().replace(/\s+/g, '-')}\n\ngo 1.21\n`,
      'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n    fmt.Println("Hello, World!")\n}',
      'README.md': `# ${projectName}\n\nA new Go project created with Cortex.\n`,
    },
  };

  return templates[language] || {
    'README.md': `# ${projectName}\n\nA new project created with Cortex.\n`,
  };
}

/**
 * Detect programming language from GitHub URL
 */
export function detectLanguageFromGitHub(githubUrl: string): string {
  const url = githubUrl.toLowerCase();

  if (url.includes('rust') || url.includes('.rs')) return 'rust';
  if (url.includes('python') || url.includes('py')) return 'python';
  if (url.includes('typescript') || url.includes('ts')) return 'typescript';
  if (url.includes('go') || url.includes('golang')) return 'go';
  if (url.includes('java')) return 'java';
  if (url.includes('cpp') || url.includes('c++')) return 'cpp';
  if (url.includes('csharp') || url.includes('dotnet')) return 'csharp';
  if (url.includes('php')) return 'php';
  if (url.includes('ruby')) return 'ruby';

  return 'javascript'; // Default fallback
}