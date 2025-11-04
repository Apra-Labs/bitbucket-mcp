#!/usr/bin/env node
/**
 * CLI interface to Bitbucket API using BitbucketClient
 * This provides a command-line tool that can be invoked via bash/node
 * without needing the full MCP server infrastructure
 */

import { BitbucketClient, BitbucketConfig } from "./client.js";
import fs from "fs";
import path from "path";
import os from "os";

/**
 * Load credentials from multiple sources with priority:
 * 1. Project level: ./credentials.json or ./.bitbucket-credentials
 * 2. User level: ~/.bitbucket-credentials
 * 3. Skill level: ~/.claude/skills/bitbucket-devops/credentials.json
 * 4. Environment variables (for backward compatibility)
 */
function loadConfig(): BitbucketConfig {
  const credentialPaths = [
    // Project level (highest priority)
    path.join(process.cwd(), "credentials.json"),
    path.join(process.cwd(), ".bitbucket-credentials"),
    // User level
    path.join(os.homedir(), ".bitbucket-credentials"),
    // Skill level (lowest priority)
    path.join(os.homedir(), ".claude", "skills", "bitbucket-devops", "credentials.json"),
  ];

  // Try to load from credential files
  for (const credPath of credentialPaths) {
    if (fs.existsSync(credPath)) {
      try {
        const content = fs.readFileSync(credPath, "utf-8");
        const creds = JSON.parse(content);

        // VALIDATE user_email field
        if (creds.user_email && creds.user_email.includes('@')) {
          // Valid email format
        } else if (creds.user_email) {
          throw new Error(
            `Invalid credentials in ${credPath}:\n` +
            `  'user_email' must be an email address.\n` +
            `  Got: "${creds.user_email}"\n` +
            `  Expected format: "your-email@example.com"\n` +
            `  Check your credentials.json file.`
          );
        } else if (!creds.user_email) {
          throw new Error(
            `Missing required field in ${credPath}:\n` +
            `  'user_email' (your Bitbucket account email) is required.\n` +
            `  Example: "user_email": "akhil@apra.in"\n` +
            `  Get your credentials template from: credentials.json.template`
          );
        }

        // VALIDATE username field (must NOT be an email)
        if (creds.username && creds.username.includes('@')) {
          throw new Error(
            `Invalid credentials in ${credPath}:\n` +
            `  'username' should be your Bitbucket username, not email.\n` +
            `  Got: "${creds.username}" (this looks like an email)\n` +
            `  Expected: Your workspace slug (e.g., "kumaakh")\n` +
            `  Hint: Your username is typically the same as your workspace.\n` +
            `  Fix: Change "username": "${creds.username}" to "username": "${creds.workspace || 'your-username'}"`
          );
        } else if (!creds.username) {
          throw new Error(
            `Missing required field in ${credPath}:\n` +
            `  'username' (your Bitbucket username/workspace slug) is required.\n` +
            `  Example: "username": "kumaakh"\n` +
            `  This is used for git operations, not API calls.\n` +
            `  It's typically the same as your workspace slug.`
          );
        }

        return {
          baseUrl: creds.url || creds.baseUrl || "https://api.bitbucket.org/2.0",
          token: creds.token,
          username: creds.user_email,  // API authentication uses email
          password: creds.password || creds.app_password,
          defaultWorkspace: creds.workspace || creds.username,
          gitUsername: creds.username,  // Git operations use username
        };
      } catch (error) {
        // Re-throw validation errors with full message
        if (error instanceof Error && error.message.includes('Invalid credentials')) {
          throw error;
        }
        console.error(`Warning: Failed to parse credentials from ${credPath}:`, error);
        continue;
      }
    }
  }

  // Fallback to environment variables (no validation for env vars for now)
  return {
    baseUrl: process.env.BITBUCKET_URL || "https://api.bitbucket.org/2.0",
    token: process.env.BITBUCKET_TOKEN,
    username: process.env.BITBUCKET_USERNAME,  // Assumes email in env var
    password: process.env.BITBUCKET_PASSWORD,
    defaultWorkspace: process.env.BITBUCKET_WORKSPACE,
    gitUsername: process.env.BITBUCKET_WORKSPACE,  // Use workspace for git
  };
}

/**
 * Smart pipeline identifier resolver
 * Accepts either build number (60) or UUID ({abc-123...}) and returns UUID
 * @param client BitbucketClient instance
 * @param workspace Workspace slug
 * @param repo Repository slug
 * @param identifier Build number or UUID
 * @returns Promise<string> Pipeline UUID
 */
async function resolvePipelineIdentifier(
  client: BitbucketClient,
  workspace: string,
  repo: string,
  identifier: string
): Promise<string> {
  // If it looks like a UUID (contains { or has dashes), use it directly
  if (identifier.includes('{') || identifier.includes('-')) {
    return identifier;
  }

  // If it's a pure number, treat as build number and look up UUID
  const buildNumber = parseInt(identifier);
  if (!isNaN(buildNumber)) {
    console.error(`🔍 Detected build number ${buildNumber}, looking up UUID...`);

    // Search recent pipelines for this build number
    const pipelines = await client.listPipelineRuns(workspace, repo, 100);
    const pipeline = pipelines.values?.find(p => p.build_number === buildNumber);

    if (!pipeline) {
      throw new Error(
        `Pipeline build #${buildNumber} not found in recent 100 pipelines. ` +
        `Try using the UUID directly or increase search range.`
      );
    }

    console.error(`✓ Found UUID: ${pipeline.uuid}`);
    return pipeline.uuid;
  }

  // Otherwise, assume it's a UUID
  return identifier;
}

/**
 * Main CLI handler
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: bitbucket-cli <command> [arguments...]");
    console.error("\nAvailable commands:");
    console.error("  list-pipelines <workspace> <repo> [limit] [status]");
    console.error("  get-pipeline <workspace> <repo> <build_number_or_uuid>");
    console.error("  get-pipeline-steps <workspace> <repo> <build_number_or_uuid>");
    console.error("  get-step-logs <workspace> <repo> <build_number_or_uuid> <step_uuid>");
    console.error("  tail-step-log <workspace> <repo> <build_number_or_uuid> <step_uuid> [bytes]");
    console.error("  run-pipeline <workspace> <repo> <branch> [custom_pipeline_name]");
    console.error("  stop-pipeline <workspace> <repo> <build_number_or_uuid>");
    console.error("  list-repos [workspace] [limit]");
    console.error("  get-repo <workspace> <repo>");
    console.error("  list-prs <workspace> <repo> [state] [limit]");
    console.error("  get-pr <workspace> <repo> <pr_id>");
    console.error("  approve-pr <workspace> <repo> <pr_id>");
    console.error("  merge-pr <workspace> <repo> <pr_id> [message] [strategy]");
    console.error("  decline-pr <workspace> <repo> <pr_id> [message]");
    console.error("  get-branching-model <workspace> <repo>");
    console.error("\nNote: Pipeline commands accept either build number (60) or UUID ({abc...})");
    process.exit(1);
  }

  const command = args[0];

  try {
    const config = loadConfig();
    const client = new BitbucketClient(config);

    switch (command) {
      case "list-pipelines": {
        const [workspace, repo, limit, status] = args.slice(1);
        if (!workspace || !repo) {
          throw new Error("Usage: list-pipelines <workspace> <repo> [limit] [status]");
        }
        const result = await client.listPipelineRuns(
          workspace,
          repo,
          limit ? parseInt(limit) : undefined,
          status as any
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-pipeline": {
        const [workspace, repo, pipeline_id] = args.slice(1);
        if (!workspace || !repo || !pipeline_id) {
          throw new Error("Usage: get-pipeline <workspace> <repo> <pipeline_uuid_or_build_number>");
        }
        const uuid = await resolvePipelineIdentifier(client, workspace, repo, pipeline_id);
        const result = await client.getPipelineRun(workspace, repo, uuid);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-pipeline-steps": {
        const [workspace, repo, pipeline_id] = args.slice(1);
        if (!workspace || !repo || !pipeline_id) {
          throw new Error("Usage: get-pipeline-steps <workspace> <repo> <pipeline_uuid_or_build_number>");
        }
        const uuid = await resolvePipelineIdentifier(client, workspace, repo, pipeline_id);
        const result = await client.getPipelineSteps(workspace, repo, uuid);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-step-logs": {
        const [workspace, repo, pipeline_id, step_uuid] = args.slice(1);
        if (!workspace || !repo || !pipeline_id || !step_uuid) {
          throw new Error("Usage: get-step-logs <workspace> <repo> <pipeline_uuid_or_build_number> <step_uuid>");
        }
        const uuid = await resolvePipelineIdentifier(client, workspace, repo, pipeline_id);
        const result = await client.getPipelineStepLogs(workspace, repo, uuid, step_uuid);
        console.log(result); // Output as plain text, not JSON
        break;
      }

      case "tail-step-log": {
        const [workspace, repo, pipeline_id, step_uuid, bytesStr] = args.slice(1);
        if (!workspace || !repo || !pipeline_id || !step_uuid) {
          throw new Error("Usage: tail-step-log <workspace> <repo> <pipeline_uuid_or_build_number> <step_uuid> [bytes]");
        }
        const uuid = await resolvePipelineIdentifier(client, workspace, repo, pipeline_id);
        const bytes = bytesStr ? parseInt(bytesStr) : 2000;
        const result = await client.getPipelineStepLogTail(workspace, repo, uuid, step_uuid, bytes);
        console.log(result); // Output as plain text, not JSON
        break;
      }

      case "run-pipeline": {
        const [workspace, repo, branch, custom_pipeline] = args.slice(1);
        if (!workspace || !repo || !branch) {
          throw new Error("Usage: run-pipeline <workspace> <repo> <branch> [custom_pipeline_name]");
        }
        const target: any = {
          ref_type: "branch",
          ref_name: branch,
        };
        if (custom_pipeline) {
          target.selector_type = "custom";
          target.selector_pattern = custom_pipeline;
        }
        const result = await client.runPipeline(workspace, repo, target);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "stop-pipeline": {
        const [workspace, repo, pipeline_id] = args.slice(1);
        if (!workspace || !repo || !pipeline_id) {
          throw new Error("Usage: stop-pipeline <workspace> <repo> <pipeline_uuid_or_build_number>");
        }
        const uuid = await resolvePipelineIdentifier(client, workspace, repo, pipeline_id);
        const result = await client.stopPipeline(workspace, repo, uuid);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "list-repos": {
        const [workspace, limit] = args.slice(1);
        const result = await client.listRepositories(
          workspace,
          limit ? parseInt(limit) : undefined
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-repo": {
        const [workspace, repo] = args.slice(1);
        if (!workspace || !repo) {
          throw new Error("Usage: get-repo <workspace> <repo>");
        }
        const result = await client.getRepository(workspace, repo);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "list-prs": {
        const [workspace, repo, state, limit] = args.slice(1);
        if (!workspace || !repo) {
          throw new Error("Usage: list-prs <workspace> <repo> [state] [limit]");
        }
        const result = await client.getPullRequests(
          workspace,
          repo,
          state as any,
          limit ? parseInt(limit) : undefined
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-pr": {
        const [workspace, repo, pr_id] = args.slice(1);
        if (!workspace || !repo || !pr_id) {
          throw new Error("Usage: get-pr <workspace> <repo> <pr_id>");
        }
        const result = await client.getPullRequest(workspace, repo, pr_id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "approve-pr": {
        const [workspace, repo, pr_id] = args.slice(1);
        if (!workspace || !repo || !pr_id) {
          throw new Error("Usage: approve-pr <workspace> <repo> <pr_id>");
        }
        const result = await client.approvePullRequest(workspace, repo, pr_id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "merge-pr": {
        const [workspace, repo, pr_id, message, strategy] = args.slice(1);
        if (!workspace || !repo || !pr_id) {
          throw new Error("Usage: merge-pr <workspace> <repo> <pr_id> [message] [strategy]");
        }
        const result = await client.mergePullRequest(
          workspace,
          repo,
          pr_id,
          message,
          strategy as "merge-commit" | "squash" | "fast-forward" | undefined
        );
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "decline-pr": {
        const [workspace, repo, pr_id, message] = args.slice(1);
        if (!workspace || !repo || !pr_id) {
          throw new Error("Usage: decline-pr <workspace> <repo> <pr_id> [message]");
        }
        const result = await client.declinePullRequest(workspace, repo, pr_id, message);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-branching-model": {
        const [workspace, repo] = args.slice(1);
        if (!workspace || !repo) {
          throw new Error("Usage: get-branching-model <workspace> <repo>");
        }
        const result = await client.getRepositoryBranchingModel(workspace, repo);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-pr-diff": {
        const [workspace, repo, pr_id] = args.slice(1);
        if (!workspace || !repo || !pr_id) {
          throw new Error("Usage: get-pr-diff <workspace> <repo> <pr_id>");
        }
        const result = await client.getPullRequestDiff(workspace, repo, pr_id);
        console.log(result); // Output as plain text
        break;
      }

      case "get-pr-comments": {
        const [workspace, repo, pr_id] = args.slice(1);
        if (!workspace || !repo || !pr_id) {
          throw new Error("Usage: get-pr-comments <workspace> <repo> <pr_id>");
        }
        const result = await client.getPullRequestComments(workspace, repo, pr_id);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the CLI
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
