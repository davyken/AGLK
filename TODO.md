# Task: Implement Notification Deduplication for Demand/Supply Matches

## Remaining Steps
1. ✅ Plan approved by user
2. 🗒️ Create TODO.md [DONE]
3. 📝 Update `backend/src/common/schemas/notification.schema.ts`: Add `dedupHash` prop + compound index `{dedupHash: 1, userPhone: 1, createdAt: -1}`.
4. 📝 Update `backend/src/notification/notification.service.ts`: 
   - Inject `@InjectModel(Notification.name)` model.
   - Add `checkDuplicateNotification(phone: string, dedupHash: string)` method.
   - In `notifyBuyersOfNewSupply()` & `notifyFarmersOfNewDemand()`: compute hash, check dup, if unique → send + create queued Notification doc (status='sent').
   - Enhance templates: append listing ID to SELL/BUY commands.
5. 📥 Import Notification schema to `backend/src/notification/notification.module.ts`.
6. 🧪 Test: Create duplicate-triggering listings, verify single notifications.
7. 🚀 Run `cd backend && npm run start:dev` and monitor logs.

## Progress
- [x] Gather files & understand code
- [x] Brainstorm & confirm plan
- [ ] Implement schema changes
- [ ] Implement service logic
- [ ] Update module imports
- [ ] Test deduplication

**Next step: Update notification.schema.ts**
