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
 * 3. Skill level: ~/.claude/skills/bitbucket-pipeline-debug/credentials.json
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
    path.join(os.homedir(), ".claude", "skills", "bitbucket-pipeline-debug", "credentials.json"),
  ];

  // Try to load from credential files
  for (const credPath of credentialPaths) {
    if (fs.existsSync(credPath)) {
      try {
        const content = fs.readFileSync(credPath, "utf-8");
        const creds = JSON.parse(content);

        return {
          baseUrl: creds.url || creds.baseUrl || "https://api.bitbucket.org/2.0",
          token: creds.token,
          username: creds.username,
          password: creds.password || creds.app_password,
          defaultWorkspace: creds.workspace || creds.defaultWorkspace,
        };
      } catch (error) {
        console.error(`Warning: Failed to parse credentials from ${credPath}:`, error);
        continue;
      }
    }
  }

  // Fallback to environment variables
  return {
    baseUrl: process.env.BITBUCKET_URL || "https://api.bitbucket.org/2.0",
    token: process.env.BITBUCKET_TOKEN,
    username: process.env.BITBUCKET_USERNAME,
    password: process.env.BITBUCKET_PASSWORD,
    defaultWorkspace: process.env.BITBUCKET_WORKSPACE,
  };
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
    console.error("  get-pipeline <workspace> <repo> <pipeline_uuid>");
    console.error("  get-pipeline-steps <workspace> <repo> <pipeline_uuid>");
    console.error("  get-step-logs <workspace> <repo> <pipeline_uuid> <step_uuid>");
    console.error("  run-pipeline <workspace> <repo> <branch> [custom_pipeline_name]");
    console.error("  list-repos [workspace] [limit]");
    console.error("  get-repo <workspace> <repo>");
    console.error("  list-prs <workspace> <repo> [state] [limit]");
    console.error("  get-pr <workspace> <repo> <pr_id>");
    console.error("  get-branching-model <workspace> <repo>");
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
        const [workspace, repo, pipeline_uuid] = args.slice(1);
        if (!workspace || !repo || !pipeline_uuid) {
          throw new Error("Usage: get-pipeline <workspace> <repo> <pipeline_uuid>");
        }
        const result = await client.getPipelineRun(workspace, repo, pipeline_uuid);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-pipeline-steps": {
        const [workspace, repo, pipeline_uuid] = args.slice(1);
        if (!workspace || !repo || !pipeline_uuid) {
          throw new Error("Usage: get-pipeline-steps <workspace> <repo> <pipeline_uuid>");
        }
        const result = await client.getPipelineSteps(workspace, repo, pipeline_uuid);
        console.log(JSON.stringify(result, null, 2));
        break;
      }

      case "get-step-logs": {
        const [workspace, repo, pipeline_uuid, step_uuid] = args.slice(1);
        if (!workspace || !repo || !pipeline_uuid || !step_uuid) {
          throw new Error("Usage: get-step-logs <workspace> <repo> <pipeline_uuid> <step_uuid>");
        }
        const result = await client.getPipelineStepLogs(workspace, repo, pipeline_uuid, step_uuid);
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
