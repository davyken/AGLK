# TODO.md - Agrolink Buy Flow Improvement

## Objective
Modify VoltAgent so crop+location queries (e.g. "i am in tiko and i need casava") immediately show available listings **without** asking quantity/budget.

## Steps (8/10 complete)

### ✅ Done
- [x] Analyzed full message flow (bot.controller → voltagent → orchestrator → tools)
- [x] Confirmed root cause: responseGeneratorTool prompts ask quantity post-search
- [x] User approved detailed edit plan
- [x] Created TODO.md ✅
- [x] Edited dataExtractionTool.ts (buy_produce: quantity optional, missingFields=[] for crop+location)
- [x] Edited orchestrator.ts (buy_produce short-circuit logic)
- [x] Edited responseGeneratorTool.ts (buy_produce: show listings, NO quantity questions)
- [x] Edited routerTool.ts (high-confidence buy_produce detection)

### ⏳ In Progress  
### 📋 Remaining (2 steps)
5. **Test locally**
   - `npm run start:dev`
   - Send "i am in tiko and i need casava" 
   - Verify: listings shown, no quantity/budget prompt

6. **Full regression + attempt_completion**

5. **Test locally**
   - `npm run start:dev`
   - Send "i am in tiko and i need casava" 
   - Verify: listings shown, no quantity/budget prompt

6. **Full regression + attempt_completion**

## Priority
High - fixes core UX issue immediately

## Status
✅ TODO created. Ready for code edits.
