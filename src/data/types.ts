export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface Repo {
  id: string;
  full_name: string;
  owner: string;
  name: string;
  url: string | null;
  created_at: string;
}

export interface WorkspaceWithRepos extends Workspace {
  repos: Repo[];
}
