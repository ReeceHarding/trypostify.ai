import {
  json,
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  index,
} from 'drizzle-orm/pg-core'
import { user } from './auth'
import { InferSelectModel } from 'drizzle-orm'

export const mediaLibrary = pgTable('media_library', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  s3Key: text('s3_key').notNull(),
  media_id: text('media_id').notNull(), // Twitter media ID
  filename: text('filename').notNull(),
  fileType: text('file_type').notNull(), // mime type (e.g., 'image/jpeg')
  mediaType: text('media_type').notNull(), // 'image', 'gif', 'video'
  sizeBytes: integer('size_bytes'),
  tags: json('tags').$type<string[]>().default([]),
  isStarred: boolean('is_starred').notNull().default(false),
  isDeleted: boolean('is_deleted').notNull().default(false), // Soft delete flag
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => {
  return {
    userIdIdx: index('media_library_user_id_idx').on(table.userId),
    mediaTypeIdx: index('media_library_media_type_idx').on(table.mediaType),
    isDeletedIdx: index('media_library_is_deleted_idx').on(table.isDeleted),
    createdAtIdx: index('media_library_created_at_idx').on(table.createdAt),
  }
})

export type MediaLibraryItem = InferSelectModel<typeof mediaLibrary>
