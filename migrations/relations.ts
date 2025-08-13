import { relations } from "drizzle-orm/relations";
import { user, account, session, knowledgeDocument, knowledgeTags, tweets, mediaLibrary } from "./schema";

export const accountRelations = relations(account, ({one, many}) => ({
	user: one(user, {
		fields: [account.userId],
		references: [user.id]
	}),
	tweets: many(tweets),
}));

export const userRelations = relations(user, ({many}) => ({
	accounts: many(account),
	sessions: many(session),
	knowledgeDocuments: many(knowledgeDocument),
	tweets: many(tweets),
	mediaLibraries: many(mediaLibrary),
}));

export const sessionRelations = relations(session, ({one}) => ({
	user: one(user, {
		fields: [session.userId],
		references: [user.id]
	}),
}));

export const knowledgeDocumentRelations = relations(knowledgeDocument, ({one, many}) => ({
	user: one(user, {
		fields: [knowledgeDocument.userId],
		references: [user.id]
	}),
	knowledgeTags: many(knowledgeTags),
}));

export const knowledgeTagsRelations = relations(knowledgeTags, ({one}) => ({
	knowledgeDocument: one(knowledgeDocument, {
		fields: [knowledgeTags.knowledgeId],
		references: [knowledgeDocument.id]
	}),
}));

export const tweetsRelations = relations(tweets, ({one}) => ({
	user: one(user, {
		fields: [tweets.userId],
		references: [user.id]
	}),
	account: one(account, {
		fields: [tweets.accountId],
		references: [account.id]
	}),
}));

export const mediaLibraryRelations = relations(mediaLibrary, ({one}) => ({
	user: one(user, {
		fields: [mediaLibrary.userId],
		references: [user.id]
	}),
}));