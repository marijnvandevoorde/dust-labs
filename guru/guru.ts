import axios, { AxiosRequestConfig, AxiosResponse } from 'axios'

export interface GuruCardRaw {
    content: string
    id: string
    lastModified: string
    owner: {
        status: string
        email: string
        firstName: string
        lastName: string
        profilePicUrl: string
    }
    slug: string
    collection: {
        name: string
        id: string
        color: string
        collectionType: string
        publicCardsEnabled: boolean
        roiEnabled: boolean
    }
    dateCreated: string
    verifiers: GuruCardVerifiers

    cardVerifier?: string

    verificationInterval: number
    lastVerified: string
    lastVerifiedBy: {
        status: string
        email: string
        firstName: string
        lastName: string
        profilePicUrl: string
    }
    lastModifiedBy: {
        status: string
        email: string
        firstName: string
        lastName: string
        profilePicUrl: string
    }
    htmlContent: boolean
    shareStatus: string
    boards: Array<{
        id: string
        title: string
        slug: string
        items: any[]
        numberOfFacts: number
    }>
    preferredPhrase: string
    originalOwner: {
        status: string
        email: string
        firstName: string
        lastName: string
        profilePicUrl: string
    }
    verificationState: string
    verificationType: string
    cardType: string
    nextVerificationDate: string
    cardInfo: {
        analytics: {
            unverifiedViews: number
            boards: number
            views: number
            copies: number
            unverifiedCopies: number
            favorites: number
        }
    }
}

export interface GuruCardUserVerifier {
    type: 'user'
    user: {
        status: string
        email: string
        firstName: string
        lastName: string
        profilePicUrl: string
    }
    id: string
}

export interface GuruCardGroupVerifier {
    type: 'user-group'
    userGroup: {
        name: string
        id: string
        modifiable: boolean
    }
    id: string
}

export interface GroupMember {
    id: string
    user: {
        status: string
        email: string
        lastName: string
        firstName: string
        profilePicUrl: string
    }
    dateCreated: string
}

export type GuruCardVerifiers = GuruCardUserVerifier[] | GuruCardGroupVerifier[]

export interface GuruCard {
    [key: string]: any
    id: string
    title: string
    owner: string
    firstName: string
    lastName: string
    verifier: string
    collection: string
    boards: string[]
    content: string
    verificationDate: string
    verificationState: string
    verificationInterval: number
    link: string
}

export interface GuruConfig {
    /** email of account to auth with */
    email: string
    /** API token generated from https://app.getguru.com/settings/api-access */
    token: string
}

export class Guru {
    private readonly email: string
    private readonly token: string
    private readonly httpConfig: AxiosRequestConfig

    constructor(_config: GuruConfig) {
        this.email = _config.email
        this.token = _config.token

        this.httpConfig = {
            baseURL: 'https://api.getguru.com/api/v1',
            auth: {
                username: this.email,
                password: this.token,
            },
        }
    }

    private async _request(
        method: AxiosRequestConfig['method'],
        url: string,
        data?: any,
        axiosOptions?: AxiosRequestConfig,
    ): Promise<AxiosResponse> {
        try {
            const res = await axios(url, {
                method,
                data,
                ...this.httpConfig,
                ...(axiosOptions ?? {}),
            })
            return res
        } catch (err: any) {
            if (err.response.status === 401) {
                throw new Error('Could not authenticate to Guru, check credentials and try again.')
            }
            throw err
        }
    }

    _convertCardModel(cardRaw: GuruCardRaw): GuruCard {
        return {
            id: cardRaw.id,
            title: cardRaw.preferredPhrase,
            owner: cardRaw?.owner?.email ?? this.email,
            firstName: cardRaw.owner.firstName,
            lastName: cardRaw.owner.lastName,
            verifier: cardRaw?.cardVerifier ?? '',
            collection: cardRaw.collection.name,
            boards: cardRaw.boards ? cardRaw.boards.map((board) => board.title) : [],
            content: cardRaw.content,
            verificationDate: cardRaw.nextVerificationDate,
            verificationState: cardRaw.verificationState,
            verificationInterval: cardRaw.verificationInterval,
            link: `https://app.getguru.com/card/${cardRaw.slug}`,
        }
    }

    async getGroupMembers(groupID: string): Promise<GroupMember[]> {
        const res = await this._request('GET', `groups/${groupID}/members`)
        return res.data
    }

    async getVerifier(verifiers: GuruCardVerifiers) {
        let verifier = ''

        if (verifiers[0]?.type === 'user-group') {
            const groupID = verifiers[0]?.userGroup?.id

            if (!groupID) return ''

            const members = await this.getGroupMembers(groupID)

            if (!members.length) return ''

            verifier = members[0]?.user?.email
        } else {
            verifier = verifiers?.length ? verifiers[0]?.user?.email : this.email
        }

        return verifier
    }

    async getAllCardsRaw() {
        const allCards: GuruCardRaw[] = []

        // get first page of articles and push into final array
        let res = await this._request('POST', '/search/cardmgr', {})

        do {
            allCards.push(...res.data)
            const pageLink = res?.headers?.link?.match(/(?<=<)(.*)(?=>)/gs)![0]
            if (!pageLink) break
            res = await this._request('POST', pageLink, {})
        } while (res?.headers?.link)

        for (const card of allCards) {
            card.cardVerifier = await this.getVerifier(card.verifiers)
        }

        return allCards
    }

    async getAllCards(): Promise<GuruCard[]> {
        const allCards = await this.getAllCardsRaw()
        return allCards.map(this._convertCardModel)
    }
}