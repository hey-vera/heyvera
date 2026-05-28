import React, { useState, useEffect } from 'react';
import { Plus, ExternalLink, Trash2, GitBranch, Upload, Code, Loader, MessageSquare } from 'lucide-react';
import {
  listProjects,
  createProject,
  importProject,
  deleteProject,
  getAvailableLanguages,
  getTemplateFiles,
  detectLanguageFromGitHub,
  type ProjectWorkspace,
  type CreateProjectRequest,
  type ImportProjectRequest,
} from '../lib/replitProjectApi';

type ProjectType = 'create' | 'github' | 'upload' | null;

const ReplitProjects: React.FC = () => {
  const [projects, setProjects] = useState<ProjectWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [projectType, setProjectType] = useState<ProjectType>(null);

  // Form state
  const [projectName, setProjectName] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [description, setDescription] = useState('');
  const [githubUrl, setGithubUrl] = useState('');

  const languages = getAvailableLanguages();

  const loadProjects = async () => {
    try {
      const projectList = await listProjects();
      setProjects(projectList);
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async () => {
    if (!projectName.trim()) return;
    setCreating(true);

    try {
      if (projectType === 'create') {
        const files = getTemplateFiles(language, projectName);
        const request: CreateProjectRequest = {
          title: projectName,
          language,
          description: description || undefined,
          files,
        };
        await createProject(request);
      } else if (projectType === 'github') {
        // Auto-detect language for better UX
        detectLanguageFromGitHub(githubUrl);
        const request: ImportProjectRequest = {
          name: projectName,
          source_type: 'github',
          source_url: githubUrl,
        };
        await importProject(request);
      }

      await loadProjects();
      setShowCreateDialog(false);
      resetForm();
    } catch (error) {
      console.error('Failed to create project:', error);
      alert(`Failed to create project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteProject = async (projectId: string) => {
    if (!confirm('Are you sure you want to delete this project? This will also delete the Replit workspace.')) return;

    try {
      await deleteProject(projectId);
      await loadProjects();
    } catch (error) {
      console.error('Failed to delete project:', error);
      alert(`Failed to delete project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const resetForm = () => {
    setProjectName('');
    setLanguage('javascript');
    setDescription('');
    setGithubUrl('');
    setProjectType(null);
  };

  const openChat = (workspace: ProjectWorkspace) => {
    // Navigate to main app with workspace context
    const params = new URLSearchParams();
    params.set('workspace', workspace.workspace_id);
    params.set('project', workspace.id);
    window.location.href = `/?${params.toString()}`;
  };

  useEffect(() => {
    loadProjects();
  }, []);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'text-green-400 bg-green-500/10 border-green-500/20';
      case 'creating': return 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20';
      case 'error': return 'text-red-400 bg-red-500/10 border-red-500/20';
      default: return 'text-gray-400 bg-gray-500/10 border-gray-500/20';
    }
  };

  const getLanguageIcon = (lang?: string) => {
    const language = languages.find(l => l.value === lang);
    return language?.icon || '📄';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex items-center text-[var(--muted)]">
          <Loader className="w-6 h-6 animate-spin mr-2" />
          Loading projects...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--fg)]">
      {/* Header */}
      <div className="border-b border-white/6 bg-[var(--panel)]">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-white">Replit Projects</h1>
              <p className="text-[var(--muted)] mt-1">Manage your BYOS workspaces with isolated chat environments</p>
            </div>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-6 py-8">
        {projects.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[var(--panel)] flex items-center justify-center">
              <Code className="w-8 h-8 text-[var(--muted)]" />
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No projects yet</h3>
            <p className="text-[var(--muted)] mb-6 max-w-md mx-auto">
              Create your first project to start developing with BYOS in isolated Replit workspaces.
              Your authenticated Claude/OpenAI subscriptions will work seamlessly.
            </p>
            <button
              onClick={() => setShowCreateDialog(true)}
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Project
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <div key={project.id} className="bg-[var(--panel)] border border-white/10 rounded-lg p-6 hover:border-white/20 transition-all">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center flex-1">
                    <span className="text-2xl mr-3">{getLanguageIcon(project.metadata?.language)}</span>
                    <div className="min-w-0 flex-1">
                      <h3 className="font-medium text-white truncate">{project.project_name}</h3>
                      <span className={`inline-block px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor(project.status)} mt-1`}>
                        {project.status}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleDeleteProject(project.id)}
                    className="text-[var(--muted)] hover:text-red-400 transition-colors ml-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {project.metadata?.description && (
                  <p className="text-[var(--muted)] text-sm mb-4 line-clamp-2">
                    {project.metadata.description}
                  </p>
                )}

                <div className="space-y-2 mb-4">
                  <div className="text-xs text-[var(--muted)]">
                    <span className="text-white font-medium">Language:</span> {project.metadata?.language || 'Unknown'}
                  </div>
                  {project.metadata?.source_type && (
                    <div className="text-xs text-[var(--muted)]">
                      <span className="text-white font-medium">Source:</span> {project.metadata.source_type}
                    </div>
                  )}
                  <div className="text-xs text-[var(--muted)]">
                    <span className="text-white font-medium">Created:</span> {new Date(project.created_at).toLocaleDateString()}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    <span className="text-white font-medium">Workspace:</span>{' '}
                    <code className="text-blue-400">{project.workspace_id}</code>
                  </div>
                </div>

                <div className="flex space-x-2">
                  <a
                    href={project.workspace_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-white/20 text-sm font-medium rounded-md text-[var(--muted)] bg-transparent hover:bg-white/5 transition-colors"
                  >
                    <ExternalLink className="w-4 h-4 mr-1" />
                    Open Workspace
                  </a>
                  <button
                    onClick={() => openChat(project)}
                    className="flex-1 inline-flex items-center justify-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                  >
                    <MessageSquare className="w-4 h-4 mr-1" />
                    Chat
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Project Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--panel)] border border-white/10 rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto">
            <h2 className="text-lg font-medium text-white mb-4">Create New Project</h2>

            {!projectType ? (
              <div className="space-y-3">
                <button
                  onClick={() => setProjectType('create')}
                  className="w-full p-4 border border-white/10 rounded-lg hover:border-blue-400/50 hover:bg-blue-500/10 transition-all text-left"
                >
                  <div className="flex items-center">
                    <Plus className="w-5 h-5 text-blue-400 mr-3" />
                    <div>
                      <div className="font-medium text-white">Create New</div>
                      <div className="text-sm text-[var(--muted)]">Start with a blank project template</div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setProjectType('github')}
                  className="w-full p-4 border border-white/10 rounded-lg hover:border-green-400/50 hover:bg-green-500/10 transition-all text-left"
                >
                  <div className="flex items-center">
                    <GitBranch className="w-5 h-5 text-green-400 mr-3" />
                    <div>
                      <div className="font-medium text-white">Import from GitHub</div>
                      <div className="text-sm text-[var(--muted)]">Clone an existing repository</div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setProjectType('upload')}
                  disabled
                  className="w-full p-4 border border-white/10 rounded-lg text-left opacity-50 cursor-not-allowed"
                >
                  <div className="flex items-center">
                    <Upload className="w-5 h-5 text-[var(--muted)] mr-3" />
                    <div>
                      <div className="font-medium text-[var(--muted)]">Upload Files</div>
                      <div className="text-sm text-[var(--muted)]">Coming soon</div>
                    </div>
                  </div>
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-white mb-1">
                    Project Name
                  </label>
                  <input
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="My awesome project"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-white/20 rounded-md text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {projectType === 'create' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-white mb-1">
                        Language
                      </label>
                      <select
                        value={language}
                        onChange={(e) => setLanguage(e.target.value)}
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-white/20 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      >
                        {languages.map((lang) => (
                          <option key={lang.value} value={lang.value}>
                            {lang.icon} {lang.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-white mb-1">
                        Description (optional)
                      </label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Brief description of your project"
                        rows={3}
                        className="w-full px-3 py-2 bg-[var(--bg)] border border-white/20 rounded-md text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </>
                )}

                {projectType === 'github' && (
                  <div>
                    <label className="block text-sm font-medium text-white mb-1">
                      GitHub URL
                    </label>
                    <input
                      type="url"
                      value={githubUrl}
                      onChange={(e) => setGithubUrl(e.target.value)}
                      placeholder="https://github.com/username/repo"
                      className="w-full px-3 py-2 bg-[var(--bg)] border border-white/20 rounded-md text-white placeholder-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => {
                  setShowCreateDialog(false);
                  resetForm();
                }}
                className="px-4 py-2 text-[var(--muted)] border border-white/20 rounded-md hover:bg-white/5 transition-colors"
              >
                Cancel
              </button>

              {projectType && (
                <button
                  onClick={() => setProjectType(null)}
                  className="px-4 py-2 text-[var(--muted)] border border-white/20 rounded-md hover:bg-white/5 transition-colors"
                >
                  Back
                </button>
              )}

              {projectType && (
                <button
                  onClick={handleCreateProject}
                  disabled={creating || !projectName.trim() || (projectType === 'github' && !githubUrl.trim())}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center transition-colors"
                >
                  {creating && <Loader className="w-4 h-4 mr-2 animate-spin" />}
                  {creating ? 'Creating...' : 'Create Project'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReplitProjects;