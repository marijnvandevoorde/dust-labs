import axios from "axios";
import * as dotenv from "dotenv";
import Bottleneck from "bottleneck";
import { 
  LinearClient, 
  Issue, 
  Comment, 
  Attachment, 
  IssueLabel, 
  WorkflowState,
  User,
  IssueHistory,
  IssueRelation,
  LinearFetch,
} from "@linear/sdk";

dotenv.config();

// Constants
const LINEAR_MAX_BATCH_SIZE = 50;
const LINEAR_RATE_LIMIT_PER_HOUR = 1500;

// Linear API credentials and query parameters
const LINEAR_API_KEY = process.env.LINEAR_API_KEY;
const LINEAR_UPDATED_SINCE = process.env.LINEAR_UPDATED_SINCE;
const LINEAR_TEAM_KEY = process.env.LINEAR_TEAM_KEY;
const LINEAR_PROJECT_ID = process.env.LINEAR_PROJECT_ID;
const LINEAR_STATE = process.env.LINEAR_STATE;
const LINEAR_LABEL = process.env.LINEAR_LABEL;

// Optional data fetching configuration
const FETCH_CONFIG = {
  comments: process.env.FETCH_COMMENTS === 'true',
  attachments: process.env.FETCH_ATTACHMENTS == 'true',
  labels: process.env.FETCH_LABELS == 'true',
  relations: process.env.FETCH_RELATIONS == 'true',
  history: process.env.FETCH_HISTORY == 'true',
  subscribers: process.env.FETCH_SUBSCRIBERS == 'true',
  hierarchy: process.env.FETCH_HIERARCHY == 'true', // parent and children
  cycle: process.env.FETCH_CYCLE == 'true',
  organization: process.env.FETCH_ORGANIZATION == 'true',
};

// Dust API credentials
const DUST_API_KEY = process.env.DUST_API_KEY;
const DUST_WORKSPACE_ID = process.env.DUST_WORKSPACE_ID;
const DUST_DATASOURCE_ID = process.env.DUST_DATASOURCE_ID;

// Validate required environment variables
const requiredEnvVars = [
  'LINEAR_API_KEY',
  'DUST_API_KEY',
  'DUST_WORKSPACE_ID',
  'DUST_DATASOURCE_ID',
  'DUST_RATE_LIMIT',
  'LINEAR_MAX_CONCURRENT'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  throw new Error(
    `Please provide values for the following environment variables: ${missingEnvVars.join(', ')}`
  );
}

// Rate limiting configuration
const DUST_RATE_LIMIT = parseInt(process.env.DUST_RATE_LIMIT as string);
const LINEAR_MAX_CONCURRENT = parseInt(process.env.LINEAR_MAX_CONCURRENT as string);

// Initialize Linear client
const linearClient = new LinearClient({
  apiKey: LINEAR_API_KEY as string
});

// Initialize Dust API client
const dustApi = axios.create({
  baseURL: "https://dust.tt/api/v1",
  headers: {
    Authorization: `Bearer ${DUST_API_KEY}`,
    "Content-Type": "application/json",
  },
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
});

// Add rate limiting for Linear API
const linearLimiter = new Bottleneck({
  maxConcurrent: LINEAR_MAX_CONCURRENT,
  minTime: 1000 / (LINEAR_RATE_LIMIT_PER_HOUR * 0.95), // Slightly below the limit
  reservoir: LINEAR_RATE_LIMIT_PER_HOUR,
  reservoirRefreshInterval: 60 * 60 * 1000, // 1 hour
  reservoirRefreshAmount: LINEAR_RATE_LIMIT_PER_HOUR
});

// Interface definitions
interface Section {
  prefix?: string | null;
  content?: string | null;
  sections: Section[];
}

/**
 * Wrap Linear API calls with rate limiting
 */
function safeLinearFetch<T>(fetchFn: () => LinearFetch<T> | undefined): Promise<T> {
  return linearLimiter.schedule(() => {
    const linearFetch = fetchFn();
    if (!linearFetch) {
      return Promise.resolve(undefined as T);
    }
    return linearFetch.then((result) => result);
  });
}

/**
 * Get issues updated in the specified time period with optional filters
 */
async function getIssues(): Promise<Issue[]> {
  console.log(`Fetching Linear issues with the following filters:`);
  if (LINEAR_UPDATED_SINCE) console.log(`- Updated since: ${LINEAR_UPDATED_SINCE}`);
  if (LINEAR_TEAM_KEY) console.log(`- Team: ${LINEAR_TEAM_KEY}`);
  if (LINEAR_PROJECT_ID) console.log(`- Project ID: ${LINEAR_PROJECT_ID}`);
  if (LINEAR_STATE) console.log(`- State: ${LINEAR_STATE}`);
  if (LINEAR_LABEL) console.log(`- Label: ${LINEAR_LABEL}`);
  
  try {
    const filter: Record<string, any> = {};

    // Calculate the date for the updated since filter
    if (LINEAR_UPDATED_SINCE) {
      const updatedSince = new Date(process.env.LINEAR_UPDATED_SINCE as string);
  
      if (isNaN(updatedSince.getTime())) {
        throw new Error(
          `Invalid LINEAR_UPDATED_SINCE date format: "${process.env.LINEAR_UPDATED_SINCE}". Expected format: YYYY-MM-DD`
        );
      }

      filter.updatedAt = { gte: updatedSince.toISOString() };
    }

    // Add optional filters if provided
    if (LINEAR_TEAM_KEY) {
      // Get team by key directly
      const team = await safeLinearFetch(() => linearClient.team(LINEAR_TEAM_KEY));
      
      if (team) {
        filter.team = { id: { eq: team.id } };
      } else {
        console.warn(`Team with key "${LINEAR_TEAM_KEY}" not found. Ignoring team filter.`);
      }
    }
    
    if (LINEAR_PROJECT_ID) {
      filter.project = { id: { eq: LINEAR_PROJECT_ID } };
    }
    
    if (LINEAR_STATE) {
      // Get state by name
      const states = await safeLinearFetch(() => linearClient.workflowStates());
      const stateNodes = states.nodes;
      const state = stateNodes.find((s: WorkflowState) => s.name === LINEAR_STATE);
      
      if (state) {
        filter.state = { id: { eq: state.id } };
      } else {
        console.warn(`State "${LINEAR_STATE}" not found. Ignoring state filter.`);
      }
    }
    
    // Paginate through all results
    const allIssues: Issue[] = [];
    let hasNextPage = true;
    let endCursor: string | undefined;
    
    while (hasNextPage) {
      const issueConnection = await safeLinearFetch(() => 
        linearClient.issues({
          filter,
          first: LINEAR_MAX_BATCH_SIZE,
          after: endCursor
        })
      );
      
      allIssues.push(...issueConnection.nodes);
      
      hasNextPage = issueConnection.pageInfo.hasNextPage;
      endCursor = issueConnection.pageInfo.endCursor;
    }

    // Apply label filter if specified
    let filteredIssues = allIssues;
    if (LINEAR_LABEL) {
      filteredIssues = await Promise.all(
        allIssues.map(async issue => {
          const labels = await issue.labels();
          const labelNodes = labels.nodes;
          return { 
            issue, 
            hasLabel: labelNodes.some((label: IssueLabel) => label.name === LINEAR_LABEL) 
          };
        })
      ).then(results => 
        results.filter(result => result.hasLabel).map(result => result.issue)
      );
    }
    
    console.log(`Retrieved ${filteredIssues.length} issues from Linear`);
    return filteredIssues;
    
  } catch (error) {
    console.error("Error fetching Linear issues:", error);
    throw error;
  }
}

/**
 * Format issue description
 */
function formatDescription(description: string | null): string {
  return description || "No description provided";
}

/**
 * Format issue comments (if enabled)
 */
async function formatComments(issue: Issue): Promise<Section[] | null> {
  if (!FETCH_CONFIG.comments) {
    return null;
  }

  try {
    const comments = await safeLinearFetch(() => issue.comments());
    const commentNodes = comments.nodes;
    
    if (commentNodes.length === 0) {
      return [{
        prefix: "Comments",
        content: "No comments",
        sections: []
      }];
    }
    
    const commentSections = await Promise.all(
      commentNodes.map(async (comment: Comment) => {
        const user = await safeLinearFetch(() => comment.user);
        const createdAt = comment.createdAt;
        
        // Use the reactionData attribute to get reactions
        const reactionData = comment.reactionData;
        const reactionText = Object.keys(reactionData).length > 0 
          ? `\nReactions: ${Object.entries(reactionData).map(([key, value]) => `${key}: ${value}`).join(', ')}`
          : '';
        
        return {
          prefix: `Comment by ${user?.name || 'Unknown'} (${user?.email || 'No email'}) - ${createdAt.toISOString()}`,
          content: `${comment.body}${reactionText}`,
          sections: []
        } as Section;
      })
    );
    
    return [{
      prefix: "Comments",
      content: null,
      sections: commentSections
    }];
  } catch (error) {
    console.error("Error formatting comments:", error);
    throw error;
  }
}

/**
 * Format issue attachments (if enabled)
 */
async function formatAttachments(issue: Issue): Promise<Section | null> {
  if (!FETCH_CONFIG.attachments) {
    return null;
  }

  try {
    const attachments = await safeLinearFetch(() => issue.attachments());
    const attachmentNodes = attachments.nodes;
    
    if (attachmentNodes.length === 0) {
      return {
        prefix: "Attachments",
        content: "No attachments",
        sections: []
      };
    }
    
    const attachmentSections = attachmentNodes.map((attachment: Attachment) => ({
      prefix: attachment.title,
      content: attachment.url,
      sections: []
    }));
    
    return {
      prefix: "Attachments",
      content: null,
      sections: attachmentSections
    };
  } catch (error) {
    console.error("Error formatting attachments:", error);
    throw error;
  }
}

/**
 * Format issue labels (if enabled)
 */
async function formatLabels(issue: Issue): Promise<string> {
  if (!FETCH_CONFIG.labels) {
    return "";
  }

  try {
    const labels = await safeLinearFetch(() => issue.labels());
    const labelNodes = labels.nodes;
    
    if (labelNodes.length === 0) {
      return "No labels";
    }
    
    return labelNodes.map((label: IssueLabel) => 
      `${label.name}${label.description ? ` (${label.description})` : ''}`
    ).join(", ");
  } catch (error) {
    console.error("Error formatting labels:", error);
    throw error;
  }
}

/**
 * Format issue relations (if enabled)
 */
async function formatRelations(issue: Issue): Promise<Section | null> {
  if (!FETCH_CONFIG.relations) {
    return null;
  }

  try {
    const relations = await safeLinearFetch(() => issue.relations());
    const relationNodes = relations.nodes;
    
    if (relationNodes.length === 0) {
      return {
        prefix: "Issue Relations",
        content: "No relations",
        sections: []
      };
    }
    
    const relationSections = await Promise.all(
      relationNodes.map(async (relation: IssueRelation) => {
        const relatedIssue = await safeLinearFetch(() => relation.relatedIssue);
        if (!relatedIssue) {
          return {
            prefix: relation.type,
            content: 'Related issue not found',
            sections: []
          };
        }
        return {
          prefix: relation.type,
          content: `${relatedIssue.identifier} - ${relatedIssue.title}`,
          sections: []
        };
      })
    );
    
    return {
      prefix: "Issue Relations",
      content: null,
      sections: relationSections
    };
  } catch (error) {
    console.error("Error formatting relations:", error);
    throw error;
  }
}

/**
 * Format issue history (if enabled)
 */
async function formatHistory(issue: Issue): Promise<Section | null> {
  if (!FETCH_CONFIG.history) {
    return null;
  }

  try {
    const history = await safeLinearFetch(() => issue.history());
    const historyNodes = history.nodes;
    
    if (historyNodes.length === 0) {
      return {
        prefix: "Recent History",
        content: "No history",
        sections: []
      };
    }
    
    // Get the 10 most recent history items
    const recentHistory = historyNodes.slice(0, 10);
    
    const historySections = await Promise.all(
      recentHistory.map(async (historyItem: IssueHistory) => {
        const user = await safeLinearFetch(() => historyItem.actor);
        const action = historyItem.fromState && historyItem.toState 
          ? `Changed status from "${historyItem.fromState}" to "${historyItem.toState}"`
          : 'Made changes';
        
        return {
          prefix: `${historyItem.createdAt.toISOString()} - ${user?.name || 'System'}`,
          content: action,
          sections: []
        };
      })
    );
    
    return {
      prefix: "Recent History",
      content: null,
      sections: historySections
    };
  } catch (error) {
    console.error("Error formatting history:", error);
    throw error;
  }
}

/**
 * Format issue subscribers (if enabled)
 */
async function formatSubscribers(issue: Issue): Promise<string> {
  if (!FETCH_CONFIG.subscribers) {
    return "";
  }

  try {
    const subscribers = await safeLinearFetch(() => issue.subscribers());
    const subscriberNodes = subscribers.nodes;
    
    if (subscriberNodes.length === 0) {
      return "No subscribers";
    }
    
    return subscriberNodes.map((user: User) => 
      `${user.name} (${user.email})`
    ).join(", ");
  } catch (error) {
    console.error("Error formatting subscribers:", error);
    throw error;
  }
}

/**
 * Format parent issue (if enabled)
 */
async function formatParentIssue(issue: Issue): Promise<Section | null> {
  if (!FETCH_CONFIG.hierarchy) {
    return null;
  }

  try {
    const parent = await safeLinearFetch(() => issue.parent);
    
    return {
      prefix: "Parent Issue",
      content: parent ? `${parent.identifier}: ${parent.title}` : "No parent issue",
      sections: []
    };
  } catch (error) {
    console.error("Error formatting parent issue:", error);
    throw error;
  }
}

/**
 * Format child issues (if enabled)
 */
async function formatChildIssues(issue: Issue): Promise<Section | null> {
  if (!FETCH_CONFIG.hierarchy) {
    return null;
  }

  try {
    const children = await safeLinearFetch(() => issue.children());
    const childNodes = children.nodes;
    
    const childSections: Section[] = [];
    if (childNodes.length > 0) {
      childNodes.forEach((child: Issue) => {
        childSections.push({
          prefix: child.identifier,
          content: child.title,
          sections: []
        });
      });
    }
    
    return {
      prefix: "Sub-Issues",
      content: childNodes.length === 0 ? "No sub-issues" : null,
      sections: childSections
    };
  } catch (error) {
    console.error("Error formatting child issues:", error);
    throw error;
  }
}

/**
 * Format cycle information (if enabled)
 */
async function formatCycle(issue: Issue): Promise<string> {
  if (!FETCH_CONFIG.cycle) {
    return "";
  }

  try {
    const cycle = await safeLinearFetch(() => issue.cycle);
    
    if (!cycle) {
      return "Not assigned to any cycle";
    }
    
    return `${cycle.name} (${cycle.startsAt.toISOString()} to ${cycle.endsAt.toISOString()})`;
  } catch (error) {
    console.error("Error formatting cycle:", error);
    throw error;
  }
}

/**
 * Get organization information (if enabled)
 */
async function getOrganizationInfo(): Promise<Section | null> {
  if (!FETCH_CONFIG.organization) {
    return null;
  }

  try {
    const organization = await safeLinearFetch(() => linearClient.organization);
    
    return {
      prefix: "Organization",
      content: `${organization.name} (Created: ${organization.createdAt.toISOString()})`,
      sections: []
    };
  } catch (error) {
    console.error("Error getting organization info:", error);
    throw error;
  }
}

/**
 * Get human-readable priority label
 */
function getPriorityLabel(priority: number | null): string {
  if (priority === null) return 'No priority';
  
  switch (priority) {
    case 0:
      return 'No priority';
    case 1:
      return 'Urgent';
    case 2:
      return 'High';
    case 3:
      return 'Medium';
    case 4:
      return 'Low';
    default:
      return 'Custom priority';
  }
}

/**
 * Upsert issue to Dust datasource using sections
 */
async function upsertToDustDatasource(issue: Issue) {
  try {
    // Get related data - using rate-limited calls and respecting config
    const [
      team, 
      creator, 
      assignee, 
      project, 
      state, 
      comments, 
      attachments, 
      labels,
      relations,
      history,
      subscribers,
      parentIssue,
      childIssues,
      cycle,
      organizationInfo
    ] = await Promise.all([
      safeLinearFetch(() => issue.team),
      safeLinearFetch(() => issue.creator),
      safeLinearFetch(() => issue.assignee),
      safeLinearFetch(() => issue.project),
      safeLinearFetch(() => issue.state),
      formatComments(issue),
      formatAttachments(issue),
      formatLabels(issue),
      formatRelations(issue),
      formatHistory(issue),
      formatSubscribers(issue),
      formatParentIssue(issue),
      formatChildIssues(issue),
      formatCycle(issue),
      getOrganizationInfo()
    ]);
    
    const documentId = `linear-issue-${issue.id}`;
    
    // Create the main section with metadata
    const metadataSection: Section = {
      prefix: "Metadata",
      content: null,
      sections: [
        {
          prefix: "Issue Details",
          content: [
            `ID: ${issue.id}`,
            `Number: ${issue.number}`,
            `Identifier: ${issue.identifier}`,
            `URL: ${issue.url}`
          ].join('\n'),
          sections: []
        },
        {
          prefix: "Team & Project",
          content: [
            `Team: ${team?.name || 'No team'} (${team?.key || 'No key'})`,
            `Project: ${project?.name || 'No project'}`,
            `State: ${state?.name || 'Unknown state'} (${state?.type || 'Unknown type'})` 
          ].join('\n'),
          sections: []
        },
        {
          prefix: "Dates & Times",
          content: [
            `Created: ${issue.createdAt.toISOString()}`,
            `Updated: ${issue.updatedAt.toISOString()}`,
            `Started: ${issue.startedAt ? issue.startedAt.toISOString() : 'Not started'}`,
            `Completed: ${issue.completedAt ? issue.completedAt.toISOString() : 'Not completed'}`,
            `Canceled: ${issue.canceledAt ? issue.canceledAt.toISOString() : 'Not canceled'}`,
            `Auto Closed: ${issue.autoClosedAt ? issue.autoClosedAt.toISOString() : 'Not auto-closed'}`,
            `Auto Archived: ${issue.autoArchivedAt ? issue.autoArchivedAt.toISOString() : 'Not auto-archived'}`,
            `Due Date: ${issue.dueDate || 'No due date'}`,
            `Snoozed Until: ${issue.snoozedUntilAt ? issue.snoozedUntilAt.toISOString() : 'Not snoozed'}`
          ].join('\n'),
          sections: []
        },
        {
          prefix: "People",
          content: [
            `Creator: ${creator?.name || 'Unknown'} (${creator?.email || 'No email'})`,
            `Assignee: ${assignee?.name || 'Unassigned'} (${assignee?.email || 'No email'})`,
            ...(subscribers ? [`Subscribers: ${subscribers}`] : [])
          ].join('\n'),
          sections: []
        },
        {
          prefix: "Planning",
          content: [
            `Priority: ${issue.priority} (${getPriorityLabel(issue.priority)})`,
            `Estimate: ${issue.estimate !== null ? issue.estimate : 'No estimate'} points`,
            `Completed Estimate: ${issue.completedAt ? (issue.estimate !== null ? issue.estimate : 'No estimate') : 'Not completed'}`,
            ...(cycle ? [`Cycle: ${cycle}`] : []),
            ...(labels ? [`Labels: ${labels}`] : [])
          ].join('\n'),
          sections: []
        }
      ]
    };
    
    // Create the full document section structure with only enabled sections
    const sections: Section[] = [
      metadataSection,
      {
        prefix: "Description",
        content: formatDescription(issue.description ?? 'No description provided'),
        sections: []
      },
    ];
    
    // Add optional sections if they were fetched
    if (organizationInfo) sections.unshift(organizationInfo);
    if (parentIssue) sections.push(parentIssue);
    if (childIssues) sections.push(childIssues);
    if (relations) sections.push(relations);
    if (attachments) sections.push(attachments);
    if (comments) sections.push(...comments);
    if (history) sections.push(history);
    
    const section: Section = {
      prefix: issue.identifier,
      content: issue.title,
      sections: sections
    };

    // Upsert to Dust
    await dustApi.post(
      `/w/${DUST_WORKSPACE_ID}/data_sources/${DUST_DATASOURCE_ID}/documents/${documentId}`,
      {
        section: section,
        title: `${issue.identifier}: ${issue.title}`,
      }
    );
    
    console.log(`Upserted issue ${issue.identifier} to Dust datasource`);
  } catch (error) {
    console.error(
      `Error upserting issue ${issue.identifier} to Dust datasource:`,
      error
    );
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log("Data fetching configuration:");
    Object.entries(FETCH_CONFIG).forEach(([key, value]) => {
      console.log(`- ${key}: ${value ? 'Enabled' : 'Disabled'}`);
    });

    const recentIssues = await getIssues();
    console.log(
      `Found ${recentIssues.length} issues matching the criteria.`
    );

    if (recentIssues.length === 0) {
      console.log("No issues to process. Exiting.");
      return;
    }

    // Use rate limiting to avoid hitting Dust API limits
    const limiter = new Bottleneck({
      maxConcurrent: LINEAR_MAX_CONCURRENT,
      minTime: 60 * 1000 / DUST_RATE_LIMIT,
    });

    const tasks = recentIssues.map((issue) =>
      limiter.schedule(() => upsertToDustDatasource(issue))
    );

    await Promise.all(tasks);
    console.log("All issues processed successfully.");
  } catch (error) {
    console.error("An error occurred:", error);
    process.exit(1);
  }
}

main();