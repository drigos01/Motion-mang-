# MANGA MOTION — Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Identity & PII Isolation**: `/users/{userId}` stores only public creator/reader display attributes (`displayName`, `handle`, `avatarUrl`, `bio`, `accountType`, counts, `isSuspended`). Private PII (`email`) lives exclusively at `/users/{userId}/private/info` readable only by `isOwner(userId)` or `isAdmin()`.
2. **No Self-Assigned Privilege Escalation**: Users cannot create `/admins/{uid}` unless they are already an admin or match the verified bootstrapped admin email (`helciorodri@gmail.com` with `email_verified == true`). Users cannot toggle `isSuspended` on their own `/users/{userId}` profile.
3. **Chapter & Page Isolation**: A `/pages/{pageId}` document MUST match both `mangaId` and `chapterId` in its path and verify ownership of the parent `/mangas/{mangaId}` document (`authorId == request.auth.uid`). Pages from one chapter can never be written into another chapter's path.
4. **Draft & Moderation Confidentiality**: Mangas with `status == 'draft'` or `moderationStatus != 'approved'` and chapters/pages with `status == 'draft'` are readable ONLY by their `authorId` or `isAdmin()`.
5. **Strict Server Timestamps & Immutability**: `createdAt` and `updatedAt` must equal `request.time` on create; `updatedAt == request.time` and `createdAt == existing().createdAt` on update; `authorId` / `userId` / `mangaId` / `chapterId` are immutable after creation.
6. **Verified Auth Required for Writes**: All write operations require `request.auth != null && request.auth.token.email_verified == true`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Spoofed Manga Author**: `create` on `/mangas/m1` with `authorId: "victim_uid"` while authenticated as `"attacker_uid"`. -> Expected: `PERMISSION_DENIED`.
2. **Ghost Field Injection (Shadow Update)**: `create` or `update` on `/users/u1` containing unexpected field `isAdmin: true` or `verifiedBadge: true`. -> Expected: `PERMISSION_DENIED`.
3. **Self-Suspension Bypass**: `update` on `/users/u1` by owner attempting to set `isSuspended: false` when suspended by admin. -> Expected: `PERMISSION_DENIED`.
4. **Cross-Chapter Page Poisoning**: `create` on `/mangas/m1/chapters/c1/pages/p1` with `chapterId: "c2"`. -> Expected: `PERMISSION_DENIED`.
5. **Unverified Admin Email Spoof**: Request with `token.email: "helciorodri@gmail.com"` and `token.email_verified: false`. -> Expected: `PERMISSION_DENIED`.
6. **PII Leak Attempt**: Authenticated non-owner reads `/users/victim_uid/private/info`. -> Expected: `PERMISSION_DENIED`.
7. **Draft Scraping**: Anonymous or other user calls `get` or `list` on `/mangas/m_draft` where `status == 'draft'`. -> Expected: `PERMISSION_DENIED`.
8. **Path Variable ID Poisoning**: Document creation with 1,500-character ID or illegal characters (`../admin`). -> Expected: `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: `create` on `/mangas/m1` with backdated `createdAt` not equal to `request.time`. -> Expected: `PERMISSION_DENIED`.
10. **Self-Moderation Override**: Creator attempts to update `moderationStatus: "approved"` or `isFeatured: true` on their own `/mangas/m1`. -> Expected: `PERMISSION_DENIED`.
11. **Report Tampering**: Reporter attempts to update `/reports/r1` status to `"resolved"`. -> Expected: `PERMISSION_DENIED`.
12. **Comment Impersonation**: Authenticated user posts comment on `/mangas/m1/chapters/c1/comments/cm1` with `userId: "someone_else"`. -> Expected: `PERMISSION_DENIED`.
