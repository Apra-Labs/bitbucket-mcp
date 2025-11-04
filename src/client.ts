import axios, { AxiosInstance, AxiosError } from "axios";

// =========== TYPE DEFINITIONS (exported for reuse) ===========

export interface BitbucketRepository {
  uuid: string;
  name: string;
  full_name: string;
  description: string;
  is_private: boolean;
  created_on: string;
  updated_on: string;
  size: number;
  language: string;
  has_issues: boolean;
  has_wiki: boolean;
  fork_policy: string;
  owner: BitbucketAccount;
  workspace: BitbucketWorkspace;
  project: BitbucketProject;
  mainbranch?: BitbucketBranch;
  website?: string;
  scm: string;
  links: Record<string, BitbucketLink[]>;
}

export interface BitbucketAccount {
  uuid: string;
  display_name: string;
  account_id: string;
  nickname?: string;
  type: "user" | "team";
  links: Record<string, BitbucketLink[]>;
}

export interface BitbucketWorkspace {
  uuid: string;
  name: string;
  slug: string;
  type: "workspace";
  links: Record<string, BitbucketLink[]>;
}

export interface BitbucketProject {
  uuid: string;
  key: string;
  name: string;
  description?: string;
  is_private: boolean;
  type: "project";
  links: Record<string, BitbucketLink[]>;
}

export interface BitbucketBranch {
  name: string;
  type: "branch";
}

export interface BitbucketLink {
  href: string;
  name?: string;
}

export interface BitbucketPullRequest {
  id: number;
  title: string;
  description: string;
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  author: BitbucketAccount;
  source: BitbucketBranchReference;
  destination: BitbucketBranchReference;
  created_on: string;
  updated_on: string;
  closed_on?: string;
  comment_count: number;
  task_count: number;
  close_source_branch: boolean;
  reviewers: BitbucketAccount[];
  participants: BitbucketParticipant[];
  links: Record<string, BitbucketLink[]>;
  summary?: {
    raw: string;
    markup: string;
    html: string;
  };
}

export interface BitbucketBranchReference {
  branch: {
    name: string;
  };
  commit: {
    hash: string;
  };
  repository: BitbucketRepository;
}

export interface BitbucketParticipant {
  user: BitbucketAccount;
  role: "PARTICIPANT" | "REVIEWER";
  approved: boolean;
  state?: "approved" | "changes_requested" | null;
  participated_on: string;
}

export interface InlineCommentInline {
  path: string;
  from?: number;
  to?: number;
}

export interface BitbucketConfig {
  baseUrl: string;
  token?: string;
  username?: string;  // For API authentication (email address)
  password?: string;
  defaultWorkspace?: string;
  allowDangerousCommands?: boolean;
  gitUsername?: string;  // For git operations (workspace slug, not email)
}

export interface PaginatedResponse<T> {
  values: T[];
  page?: number;
  pagelen?: number;
  size?: number;
  next?: string;
}

// Normalize Bitbucket configuration for backward compatibility
export function normalizeBitbucketConfig(rawConfig: BitbucketConfig): BitbucketConfig {
  let normalizedConfig = { ...rawConfig };
  try {
    const parsed = new URL(rawConfig.baseUrl);

    // Extract workspace from bitbucket.org URLs
    if (parsed.hostname === "bitbucket.org" && parsed.pathname.length > 1) {
      const pathParts = parsed.pathname.split("/").filter((p) => p.length > 0);
      if (pathParts.length > 0 && !normalizedConfig.defaultWorkspace) {
        normalizedConfig.defaultWorkspace = pathParts[0];
      }
      normalizedConfig.baseUrl = "https://api.bitbucket.org/2.0";
    }

    // Ensure API URLs have /2.0 suffix
    if (parsed.hostname === "api.bitbucket.org") {
      if (!parsed.pathname.includes("/2.0")) {
        normalizedConfig.baseUrl = `${parsed.protocol}//${parsed.hostname}/2.0`;
      }
    }

    // Remove trailing slashes
    normalizedConfig.baseUrl = normalizedConfig.baseUrl.replace(/\/+$/, "");
  } catch {
    // Invalid URL, use as-is
  }

  return normalizedConfig;
}

/**
 * Reusable Bitbucket API client
 * Can be used standalone or wrapped by MCP server
 */
export class BitbucketClient {
  private readonly api: AxiosInstance;
  private readonly config: BitbucketConfig;

  constructor(config: BitbucketConfig) {
    this.config = normalizeBitbucketConfig(config);

    if (!this.config.baseUrl) {
      throw new Error("baseUrl is required in BitbucketConfig");
    }

    if (!this.config.token && !(this.config.username && this.config.password)) {
      throw new Error(
        "Either token or username/password is required in BitbucketConfig"
      );
    }

    // Setup Axios instance
    this.api = axios.create({
      baseURL: this.config.baseUrl,
      headers: this.config.token
        ? { Authorization: `Bearer ${this.config.token}` }
        : { "Content-Type": "application/json" },
      auth:
        this.config.username && this.config.password
          ? { username: this.config.username, password: this.config.password }
          : undefined,
    });
  }

  /**
   * Get the default workspace from config
   */
  getDefaultWorkspace(): string | undefined {
    return this.config.defaultWorkspace;
  }

  /**
   * Handle Axios errors consistently
   */
  private handleAxiosError(error: unknown, operation: string): never {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      throw new Error(
        `Bitbucket API error in ${operation}: ${axiosError.response?.status} ${axiosError.response?.statusText} - ${JSON.stringify(axiosError.response?.data)}`
      );
    }
    throw new Error(`Unexpected error in ${operation}: ${error}`);
  }

  // =========== REPOSITORY OPERATIONS ===========

  async listRepositories(
    workspace?: string,
    limit?: number,
    nameFilter?: string
  ): Promise<PaginatedResponse<BitbucketRepository>> {
    try {
      const effectiveWorkspace = workspace || this.config.defaultWorkspace;
      if (!effectiveWorkspace) {
        throw new Error("workspace parameter or defaultWorkspace config is required");
      }

      const params: Record<string, string | number> = {};
      if (limit) params.pagelen = limit;
      if (nameFilter) params.q = `name~"${nameFilter}"`;

      const response = await this.api.get(`/repositories/${effectiveWorkspace}`, { params });
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "listRepositories");
    }
  }

  async getRepository(workspace: string, repo_slug: string): Promise<BitbucketRepository> {
    try {
      const response = await this.api.get(`/repositories/${workspace}/${repo_slug}`);
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getRepository");
    }
  }

  // =========== PULL REQUEST OPERATIONS ===========

  async getPullRequests(
    workspace: string,
    repo_slug: string,
    state?: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED",
    limit?: number
  ): Promise<PaginatedResponse<BitbucketPullRequest>> {
    try {
      const params: Record<string, string | number> = {};
      if (limit) params.pagelen = limit;
      if (state) params.state = state;

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pullrequests`,
        { params }
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPullRequests");
    }
  }

  async getPullRequest(
    workspace: string,
    repo_slug: string,
    pull_request_id: string
  ): Promise<BitbucketPullRequest> {
    try {
      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPullRequest");
    }
  }

  async createPullRequest(
    workspace: string,
    repo_slug: string,
    title: string,
    description: string,
    sourceBranch: string,
    targetBranch: string,
    reviewers?: string[],
    draft?: boolean
  ): Promise<BitbucketPullRequest> {
    try {
      const payload: any = {
        title,
        description,
        source: { branch: { name: sourceBranch } },
        destination: { branch: { name: targetBranch } },
      };

      if (reviewers && reviewers.length > 0) {
        payload.reviewers = reviewers.map((uuid) => ({ uuid }));
      }

      const response = await this.api.post(
        `/repositories/${workspace}/${repo_slug}/pullrequests`,
        payload
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "createPullRequest");
    }
  }

  async approvePullRequest(
    workspace: string,
    repo_slug: string,
    pull_request_id: string
  ): Promise<any> {
    try {
      const response = await this.api.post(
        `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/approve`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "approvePullRequest");
    }
  }

  async mergePullRequest(
    workspace: string,
    repo_slug: string,
    pull_request_id: string,
    message?: string,
    strategy?: "merge-commit" | "squash" | "fast-forward"
  ): Promise<BitbucketPullRequest> {
    try {
      const payload: any = {};
      if (message) payload.message = message;
      if (strategy) payload.merge_strategy = strategy;

      const response = await this.api.post(
        `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/merge`,
        payload
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "mergePullRequest");
    }
  }

  async declinePullRequest(
    workspace: string,
    repo_slug: string,
    pull_request_id: string,
    message?: string
  ): Promise<BitbucketPullRequest> {
    try {
      const payload: any = {};
      if (message) payload.message = message;

      const response = await this.api.post(
        `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/decline`,
        payload
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "declinePullRequest");
    }
  }

  async getPullRequestComments(
    workspace: string,
    repo_slug: string,
    pull_request_id: string
  ): Promise<PaginatedResponse<any>> {
    try {
      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/comments`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPullRequestComments");
    }
  }

  async getPullRequestDiff(
    workspace: string,
    repo_slug: string,
    pull_request_id: string
  ): Promise<string> {
    try {
      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pullrequests/${pull_request_id}/diff`,
        { responseType: "text" }
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPullRequestDiff");
    }
  }

  // =========== PIPELINE OPERATIONS ===========

  async listPipelineRuns(
    workspace: string,
    repo_slug: string,
    limit?: number,
    status?: "PENDING" | "IN_PROGRESS" | "SUCCESSFUL" | "FAILED" | "ERROR" | "STOPPED",
    target_branch?: string,
    trigger_type?: "manual" | "push" | "pullrequest" | "schedule"
  ): Promise<PaginatedResponse<any>> {
    try {
      const params: Record<string, string | number> = {};
      if (limit) params.pagelen = limit;
      // Sort by newest first (descending created_on timestamp)
      params.sort = '-created_on';

      const filters: string[] = [];
      if (status) filters.push(`state.result.name="${status}"`);
      if (target_branch) filters.push(`target.ref_name="${target_branch}"`);
      if (trigger_type) filters.push(`trigger.type="${trigger_type}"`);

      if (filters.length > 0) {
        params.q = filters.join(" AND ");
      }

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pipelines/`,
        { params }
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "listPipelineRuns");
    }
  }

  async getPipelineRun(
    workspace: string,
    repo_slug: string,
    pipeline_uuid: string
  ): Promise<any> {
    try {
      // Ensure UUID is properly encoded
      const encodedUuid = pipeline_uuid.startsWith("{")
        ? pipeline_uuid
        : `{${pipeline_uuid}}`;

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pipelines/${encodedUuid}`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPipelineRun");
    }
  }

  async runPipeline(
    workspace: string,
    repo_slug: string,
    target: {
      ref_type: "branch" | "tag" | "bookmark" | "named_branch";
      ref_name: string;
      commit_hash?: string;
      selector_type?: "default" | "custom" | "pull-requests";
      selector_pattern?: string;
    },
    variables?: Array<{ key: string; value: string; secured?: boolean }>
  ): Promise<any> {
    try {
      // Transform target to match API format
      const apiTarget: any = {
        ref_type: target.ref_type,
        ref_name: target.ref_name,
        type: "pipeline_ref_target",
      };

      if (target.commit_hash) {
        apiTarget.commit = { hash: target.commit_hash };
      }

      // Build selector object (API expects nested structure)
      if (target.selector_type) {
        apiTarget.selector = {
          type: target.selector_type,
        };
        if (target.selector_pattern) {
          apiTarget.selector.pattern = target.selector_pattern;
        }
      }

      const payload: any = { target: apiTarget };
      if (variables && variables.length > 0) {
        payload.variables = variables;
      }

      const response = await this.api.post(
        `/repositories/${workspace}/${repo_slug}/pipelines/`,
        payload
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "runPipeline");
    }
  }

  async stopPipeline(
    workspace: string,
    repo_slug: string,
    pipeline_uuid: string
  ): Promise<any> {
    try {
      const encodedUuid = pipeline_uuid.startsWith("{")
        ? pipeline_uuid
        : `{${pipeline_uuid}}`;

      const response = await this.api.post(
        `/repositories/${workspace}/${repo_slug}/pipelines/${encodedUuid}/stopPipeline`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "stopPipeline");
    }
  }

  async getPipelineSteps(
    workspace: string,
    repo_slug: string,
    pipeline_uuid: string
  ): Promise<PaginatedResponse<any>> {
    try {
      const encodedUuid = pipeline_uuid.startsWith("{")
        ? pipeline_uuid
        : `{${pipeline_uuid}}`;

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pipelines/${encodedUuid}/steps/`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPipelineSteps");
    }
  }

  async getPipelineStep(
    workspace: string,
    repo_slug: string,
    pipeline_uuid: string,
    step_uuid: string
  ): Promise<any> {
    try {
      const encodedPipelineUuid = pipeline_uuid.startsWith("{")
        ? pipeline_uuid
        : `{${pipeline_uuid}}`;
      const encodedStepUuid = step_uuid.startsWith("{")
        ? step_uuid
        : `{${step_uuid}}`;

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pipelines/${encodedPipelineUuid}/steps/${encodedStepUuid}`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPipelineStep");
    }
  }

  async getPipelineStepLogs(
    workspace: string,
    repo_slug: string,
    pipeline_uuid: string,
    step_uuid: string
  ): Promise<string> {
    try {
      const encodedPipelineUuid = pipeline_uuid.startsWith("{")
        ? pipeline_uuid
        : `{${pipeline_uuid}}`;
      const encodedStepUuid = step_uuid.startsWith("{")
        ? step_uuid
        : `{${step_uuid}}`;

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pipelines/${encodedPipelineUuid}/steps/${encodedStepUuid}/log`,
        { responseType: "text" }
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPipelineStepLogs");
    }
  }

  async getPipelineStepLogTail(
    workspace: string,
    repo_slug: string,
    pipeline_uuid: string,
    step_uuid: string,
    bytes: number = 2000
  ): Promise<string> {
    try {
      const encodedPipelineUuid = pipeline_uuid.startsWith("{")
        ? pipeline_uuid
        : `{${pipeline_uuid}}`;
      const encodedStepUuid = step_uuid.startsWith("{")
        ? step_uuid
        : `{${step_uuid}}`;

      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/pipelines/${encodedPipelineUuid}/steps/${encodedStepUuid}/log`,
        { 
          responseType: "text",
          headers: {
            'Range': `bytes=-${bytes}`  // Negative offset = from end of file
          }
        }
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getPipelineStepLogTail");
    }
  }

  // =========== BRANCHING MODEL OPERATIONS ===========

  async getRepositoryBranchingModel(workspace: string, repo_slug: string): Promise<any> {
    try {
      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/branching-model`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getRepositoryBranchingModel");
    }
  }

  async getRepositoryBranchingModelSettings(workspace: string, repo_slug: string): Promise<any> {
    try {
      const response = await this.api.get(
        `/repositories/${workspace}/${repo_slug}/branching-model/settings`
      );
      return response.data;
    } catch (error) {
      return this.handleAxiosError(error, "getRepositoryBranchingModelSettings");
    }
  }
}
