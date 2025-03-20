import axios, {AxiosInstance, AxiosResponse} from 'axios';
import * as dotenv from 'dotenv';
import Bottleneck from 'bottleneck';
import mime from 'mime';

dotenv.config();

// Configuration
const {
    NUCLINO_API_KEY,
    DUST_API_KEY,
    DUST_WORKSPACE_ID,
} = process.env;


const missingEnvVars = [
    ['NUCLINO_API_KEY', NUCLINO_API_KEY],
    ['DUST_API_KEY', DUST_API_KEY],
    ['DUST_WORKSPACE_ID', DUST_WORKSPACE_ID],
].filter(([name, value]) => !value).map(([name]) => name);

if (missingEnvVars.length > 0) {
    throw new Error(`Please provide values for the following environment variables in the .env file: ${missingEnvVars.join(', ')}`);
}

/**
 * All Things Nuclino go here until I take the time to split thing up nicely.
 */

interface NuclinoField {
    object: 'field';
    id: string;
    type: string;
    name: string;
}

interface NuclinoItem {
    object: string;
    id: string;
    createdAt: Date;
    createdUserId: string;
    childIds: Array<string>;
}

class NuclinoWorkspace implements NuclinoItem {
    object: string = 'workspace';
    id: string;
    teamId: string;
    name: string;
    createdAt: Date;
    createdUserId: string;
    fields: NuclinoField[];
    childIds: string[];

    private constructor(id: string, teamId: string, name: string, createdAt: string, createdUserId: string) {
        this.id = id;
        this.teamId = teamId;
        this.name = name;
        this.createdAt = new Date(createdAt);
        this.createdUserId = createdUserId;
    }

    public static fromRawData(data: any) {
        let instance = new NuclinoWorkspace(data.id, data.teamId, data.name, data.createdAt, data.createdUserId);

        instance.fields = data.fields.map((field: any) => ({
            object: field.object,
            id: field.id,
            type: field.type,
            name: field.name,
        }));
        instance.childIds = [...data.childIds];
        return instance;
    }
}

class NuclinoUser {
    object: string = "user";
    id: string;
    firstName: string;
    lastName: string;
    email: string;

    private constructor(id: string, firstName: string, lastName: string, email: string) {
        this.id = id;
        this.firstName = firstName;
        this.lastName = lastName;
        this.email = email;
    }

    public static fromRawData(data: any) {
        return new NuclinoUser(data.id, data.firstName = 'deactivated', data.lastName = '', data.email);

    }

}

class NuclinoCollection implements NuclinoItem {
    object: string = 'collection';
    id: string;
    workspaceId: string;
    url: string;
    title: string;
    createdAt: Date;
    createdUserId: string;
    lastUpdatedAt: Date;
    lastUpdatedUserId: string;
    childIds: Array<string>;


    private constructor(id: string, workspaceId: string, title: string, createdAt: string, createdUserId: string, lastUpdatedAt: string, lastUpdatedUserId: string) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.title = title;
        this.createdAt = new Date(createdAt);
        this.createdUserId = createdUserId;
        this.lastUpdatedAt = new Date(lastUpdatedAt);
        this.lastUpdatedUserId = lastUpdatedUserId;
    }

    public static fromRawData(data: any) {
        let instance = new NuclinoCollection(data.id, data.workspaceId, data.title, data.createdAt, data.createdUserId, data.lastUpdatedAt, data.lastUpdatedUserId);

        instance.childIds = [...data.childIds];
        return instance;
    }

}

class NuclinoArticle implements NuclinoItem {
    object: string = 'item';
    id: string;
    workspaceId: string;
    url: string;
    title: string;
    createdAt: Date;
    createdUserId: string;
    lastUpdatedAt: Date;
    lastUpdatedUserId: string;
    fields: Array<NuclinoField> = [];

    childIds: Array<string> = [];
    content: string;
    meta: {
        itemIds: Array<string>,
        fileIds: Array<string>
    } = {itemIds: [], fileIds: []};


    private constructor(id: string, workspaceId: string, title: string, url: string, createdAt: string, createdUserId: string, lastUpdatedAt: string, lastUpdatedUserId: string, content: string) {
        this.id = id;
        this.workspaceId = workspaceId;
        this.title = title;
        this.url = url;
        this.createdAt = new Date(createdAt);
        this.createdUserId = createdUserId;
        this.lastUpdatedAt = new Date(lastUpdatedAt);
        this.lastUpdatedUserId = lastUpdatedUserId;
        this.content = content;
    }

    public static fromRawData(data: any) {
        let instance = new NuclinoArticle(data.id, data.workspaceId, data.title, data.url, data.createdAt, data.createdUserId, data.lastUpdatedAt, data.lastUpdatedUserId, data.content);
        /*instance.fields = data.fields.map((field: any) => ({
            object: field.object,
            id: field.id,
            type: field.type,
            name: field.name,
        }));
        */

        instance.meta = data.contentMeta
        return instance;
    }
}

/*class NuclinoFile implements NuclinoItem {
    object: string;
    id: string;
    itemId: string;
    fileName: string;
    createdAt: Date;
    createdUserId: string;
    download: {
        url: string,
        expiresAt: Date
    };

    private constructor(id: string, itemId: string, fileName: string, createdAt: string, createdUserId: string, download: any) {
        this.id = id;
        this.itemId = itemId;
        this.fileName = fileName;
        this.createdAt = new Date(createdAt);
        this.createdUserId = createdUserId;
        this.download = {
            url: download.url,
            expiresAt: new Date(download.expiresAt)
        }
    }

    public static fromRawData(data: any) {
        return new NuclinoFile(data.id, data.itemId, data.fileName, data.createdAt, data.createdUserId, data.download);
    }

    public async getRawData() {
        const body = await axios.get(this.download.url);
        return body.data.content;
    }

}
*/


class Nuclino {
    private users: Map<string, NuclinoUser> = new Map();

    constructor(
        private rateLimiter: Bottleneck,
        private apiConnection: AxiosInstance,
    ) {
        this.rateLimiter = rateLimiter;
        this.apiConnection = apiConnection;
    }

    public async getUserInfo(userId: string): Promise<NuclinoUser> {
        try {
            if (this.users.has(userId)) {
                return this.users.get(userId);
            }
            const response = await this.doThrottledGetRequest(`/users/${userId}`);
            const user = NuclinoUser.fromRawData(response.data.data);
            this.users.set(userId, user);
            return user;
        } catch (error) {
            console.error(
                `Error fetching  user ${userId}:`,
                error.message
            );
            throw error;
        }

    }

    private async doThrottledGetRequest(url: string, data?: any) {
        return this.rateLimiter.schedule(() => this.apiConnection.get(url, data));
    }

    public async getWorkspace(name: string): Promise<NuclinoWorkspace> {
        try {
            const response = await this.doThrottledGetRequest(`/workspaces`);
            const workspaceRawata = response.data.data.results.find(workspace => workspace.name === name);
            return NuclinoWorkspace.fromRawData(workspaceRawata);

        } catch (error) {
            console.error(
                `Error fetching  workspace ${name}:`,
                error.message
            );
            throw error;
        }

    }


    public async getItem(itemId: string): Promise<NuclinoItem> {
        try {
            const response = await this.doThrottledGetRequest(`/items/${itemId}`);
            switch (response.data.data.object) {
                case 'collection': {
                    return NuclinoCollection.fromRawData(response.data.data);

                }
                case 'item': {
                    return NuclinoArticle.fromRawData(response.data.data);

                }

            }
        } catch (error) {
            console.error(
                `Error fetching content for item ${itemId}:`,
                error.message
            );
            throw error;
        }
    }


   /* public async getFile(fileId: string): Promise<NuclinoFile> {
        try {
            const response = await this.doThrottledGetRequest(`/files/${fileId}`);
            return NuclinoFile.fromRawData(response.data.data);
        } catch (error) {
            console.error(
                `Error fetching file ${fileId}:`,
                error.message
            );
            throw error;
        }
    }*/


    public async getAllItems(workspaceId, after) {
        try {
            const response = await this.doThrottledGetRequest(`/items`, {
                params: {workspaceId, limit: 100, after},
            });
            return response
        } catch (error) {
            console.error('Error fetching items from Nuclino:', error);
            throw error;
        }
    }


}

/**
 * And this is for all the dust.
 */

class Dust {
    constructor(
        private rateLimiter: Bottleneck,
        private apiConnection: AxiosInstance,
    ) {
        this.rateLimiter = rateLimiter;
        this.apiConnection = apiConnection;
    }
    public async upsertArticleToDustDatasource(article: NuclinoArticle, author: NuclinoUser, lastUpdater: NuclinoUser, breadCrumb: string, destination: Dustination) {
        const documentId = `article-${article.id}`;
        const fullPath = `${breadCrumb}`
        const content = `
Path: ${fullPath}
Url: ${article.url}
Title: ${article.title}
Author: ${author.firstName} ${author.lastName}
Last updated by: ${lastUpdater.firstName} ${lastUpdater.lastName}
Created At: ${article.createdAt}
Updated At: ${article.lastUpdatedAt}
Content:
${article.content}
  `.trim();

        try {
            await this.doThrottledPostRequest(
                `/vaults/${destination.spaceId}/data_sources/${destination.sourceId}/documents/${documentId}`,
                {
                    title: article.title,
                    mime_type: 'text/markdown',
                    text: content,
                    source_url: article.url,
                }
            );
            console.log(`Upserted article ${article.id} to Dust datasource`);
        } catch (error) {
            console.error(`Error upserting article ${article.id} to Dust datasource:`, error);
        }
    }



    public async doThrottledPostRequest(url: string, data?: any, config?: any) {
        return await this.rateLimiter.schedule(() => this.apiConnection.post(url, data, config));
    }
}

/**
 * Ha, A little wordplay
 */
interface Dustination {
    spaceId: string,
    sourceId: string;
}


/**
 * Bootstrap
 */


// Create a Bottleneck limiter for Dust API
const dustLimiter = new Bottleneck({
    minTime: 500, // 500ms between requests. limit of 120 upserts / minute per workspace https://docs.dust.tt/reference/rate-limits
    maxConcurrent: 1, // Only 1 request at a time
});

const nuclinoLimiter = new Bottleneck({
    minTime: 500, // 400 between requests. per https://help.nuclino.com/b147124e-rate-limiting
    maxConcurrent: 1, // Only 1 request at a time
});


const nuclinoApi = axios.create({
    baseURL: 'https://api.nuclino.com/v0',
    headers: {
        Authorization: `${NUCLINO_API_KEY}`,
        Accept: 'application/json',
    },
});

const dustApi = axios.create({
    baseURL: `https://dust.tt/api/v1/w/${DUST_WORKSPACE_ID}/`,
    headers: {
        Authorization: `Bearer ${DUST_API_KEY}`,
        'Content-Type': 'application/json',
    },
});

const nuclino = new Nuclino(nuclinoLimiter, nuclinoApi);

const dust = new Dust(dustLimiter, dustApi);


/**
 * Time to run some code
 */



class NuclinoSyncJob {

    private syncedArticles: Map<string, boolean> = new Map();
    constructor(
        private nuclino: Nuclino,
        private dust: Dust,
        private workspaceName: string,
        private destination: Dustination
    ) {
    }

    public async run() {
        const workspace = await nuclino.getWorkspace(this.workspaceName);
        await this.recursiveSync(workspace, workspace.name);
    }


    private async  recursiveSync(nuclinoItem: NuclinoItem, breadCrumb: string) {
        switch (nuclinoItem.object) {
            case 'item': {
                if (nuclinoItem instanceof NuclinoArticle) {
                    const author = await this.nuclino.getUserInfo(nuclinoItem.createdUserId);
                    const lastUpdater = await this.nuclino.getUserInfo(nuclinoItem.lastUpdatedUserId);
                    await this.dust.upsertArticleToDustDatasource(nuclinoItem, author, lastUpdater, breadCrumb, this.destination);
                }
                return;
            }
            case 'workspace':
            case 'collection': {
                for (const item of nuclinoItem.childIds) {
                    const itemData = await this.nuclino.getItem(item);
                    this.recursiveSync(itemData, `${breadCrumb}/${itemData.title}`);

                }
            }

        }

    }

}

async function migrateContent(workspaceName: string, destination: Dustination) {
    try {
        console.log('Starting migration...' + workspaceName);
        const workspace = await nuclino.getWorkspace(workspaceName);
        await recursiveSync(workspace, workspaceName, dust, nuclino, destination);


        console.log('Migration completed successfully!');
    } catch (error) {
        console.error('Migration failed:', error.message);
    }
}

// Run the migration
if (process.argv.length < 5) {
    console.error('Usage: npm run import <nuclinoWorkspaceName> <DustSpaceId> <DustDataSourceId>');
    process.exit(1);
}
console.log(process.argv);
migrateContent(process.argv[2], {spaceId: process.argv[3], sourceId: process.argv[4]});
