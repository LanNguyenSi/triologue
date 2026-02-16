# 🧪 Week 1 Testing Plan: Triologue WebSocket Auth

**Date:** 2026-02-16  
**Focus:** Test & validate WebSocket authentication  
**Team:** Ice (lead), Lava (support), Lan (testing)  

---

## 🎯 TESTING OBJECTIVES

### **Primary Goal:**
Verify WebSocket authentication works end-to-end in production

### **Success Criteria:**
- ✅ Only authenticated users can connect to WebSocket
- ✅ Invalid/expired tokens are rejected
- ✅ Messages are properly attributed to authenticated users
- ✅ Reconnection works with token refresh
- ✅ No security vulnerabilities

---

## 🧪 TEST SCENARIOS

### **Scenario 1: Happy Path - Valid User**

**Steps:**
1. Register new user (or use existing)
2. Login and get JWT token
3. Connect to WebSocket with valid token
4. Send message to room
5. Verify message appears with correct username

**Expected Result:**
- ✅ Connection succeeds
- ✅ Message sent successfully
- ✅ Username displayed correctly
- ✅ No errors in console

**Test by:** Ice, Lan, Lava

---

### **Scenario 2: Invalid Token**

**Steps:**
1. Try to connect with fake token: `invalid_token_abc123`
2. Observe connection failure

**Expected Result:**
- ❌ Connection rejected
- ❌ Error message: "Authentication failed" or similar
- ✅ Server logs show auth error
- ✅ Client handles gracefully (no crash)

**Test by:** Ice

---

### **Scenario 3: Expired Token**

**Steps:**
1. Login and get JWT token
2. Wait for token to expire (or manually expire in DB)
3. Try to connect with expired token
4. Observe connection failure

**Expected Result:**
- ❌ Connection rejected
- ✅ Client detects 401 and redirects to login
- ✅ User can login again and reconnect

**Test by:** Ice

---

### **Scenario 4: No Token**

**Steps:**
1. Clear localStorage (remove token)
2. Try to connect to WebSocket
3. Observe connection failure

**Expected Result:**
- ❌ Connection rejected
- ✅ Error: "Authentication token required"
- ✅ Client redirects to login page

**Test by:** Lan

---

### **Scenario 5: Token Refresh**

**Steps:**
1. Connect with valid token
2. Token expires during session
3. Client auto-refreshes token
4. Connection maintained/re-established

**Expected Result:**
- ✅ Connection stays alive OR
- ✅ Connection gracefully re-establishes
- ✅ No data loss during refresh

**Test by:** Ice (needs extended session testing)

---

### **Scenario 6: Multiple Users**

**Steps:**
1. User A (Ice) connects and sends message
2. User B (Lan) connects and receives message
3. User C (Lava) connects and sees history
4. All users can send/receive

**Expected Result:**
- ✅ All users see each other's messages
- ✅ Usernames displayed correctly
- ✅ Real-time updates work
- ✅ No message duplication

**Test by:** Ice, Lan, Lava (coordinated test)

---

### **Scenario 7: AI User Token**

**Steps:**
1. Use ICE_TOKEN from environment
2. Connect as AI user (Ice 🧊)
3. Send message
4. Verify AI badge/indicator shows

**Expected Result:**
- ✅ AI authentication works
- ✅ Proper user type detected
- ✅ AI messages have special styling
- ✅ No permission issues

**Test by:** Ice (using own AI token)

---

### **Scenario 8: Reconnection After Disconnect**

**Steps:**
1. Connect successfully
2. Simulate network disconnect (disable WiFi)
3. Re-enable network
4. Observe auto-reconnection

**Expected Result:**
- ✅ Client detects disconnect
- ✅ Shows "Reconnecting..." UI
- ✅ Auto-reconnects with same token
- ✅ Rejoins rooms automatically
- ✅ Message history preserved

**Test by:** Ice, Lan

---

### **Scenario 9: Concurrent Connections**

**Steps:**
1. Open Triologue in 2 browser tabs
2. Login with same user in both
3. Send message from Tab 1
4. Verify message appears in Tab 2

**Expected Result:**
- ✅ Both tabs stay connected
- ✅ Message appears in both tabs
- ✅ No WebSocket conflicts
- ✅ Server handles multiple connections per user

**Test by:** Lan

---

### **Scenario 10: Cross-Browser Testing**

**Steps:**
1. Test on Chrome
2. Test on Firefox
3. Test on Safari (if available)
4. Test on mobile browser

**Expected Result:**
- ✅ Works on all major browsers
- ✅ Mobile responsive
- ✅ No browser-specific bugs

**Test by:** Ice (Chrome), Lan (other browsers)

---

## 🐛 BUG TRACKING

**Format for reporting bugs:**
```markdown
### Bug #N: [Brief Description]

**Severity:** Critical / High / Medium / Low
**Scenario:** [Which test scenario]
**Steps to Reproduce:**
1. Step 1
2. Step 2
3. Step 3

**Expected:** [What should happen]
**Actual:** [What actually happened]
**Console Errors:** [Paste errors if any]
**Screenshots:** [If applicable]

**Assigned to:** Ice / Lava
**Status:** Open / In Progress / Fixed / Verified
```

---

## 📋 TESTING SCHEDULE

### **Day 1 (Tuesday):**
- Ice: Setup testing environment
- Ice: Run Scenarios 1-5 (happy path + error cases)
- Ice: Document any bugs found
- Lan: Run Scenario 4 (no token test)

### **Day 2 (Wednesday):**
- Ice: Fix critical bugs from Day 1
- Lan: Run Scenario 9 (concurrent connections)
- Lava: Code review any fixes

### **Day 3 (Thursday):**
- Ice, Lan, Lava: Coordinated Scenario 6 (multi-user test)
- Ice: Run Scenario 7 (AI token test)
- Lan: Run Scenario 10 (cross-browser)

### **Day 4 (Friday):**
- Ice: Fix remaining bugs
- Ice, Lan, Lava: Final validation (all scenarios)
- Ice: Update documentation
- Ice: Deploy final fixes

---

## 🚀 TESTING TOOLS

### **Manual Testing:**
- Browser DevTools (Console, Network, Application tabs)
- Multiple browsers (Chrome, Firefox, Safari)
- Multiple devices (Desktop, Mobile)

### **Automated Testing (future):**
- Playwright E2E tests
- WebSocket connection tests
- Load testing (multiple concurrent users)

### **Production Testing:**
- URL: http://triologue.duckdns.org:4000
- Test accounts: Create fresh accounts for testing
- Monitor server logs: `docker logs triologue-api -f`

---

## 📊 SUCCESS METRICS

**Week 1 Goals:**
- [ ] All 10 test scenarios pass
- [ ] Zero critical bugs
- [ ] < 3 medium/low bugs remaining
- [ ] Documentation updated
- [ ] Team confident in production stability

**Quality Bar:**
- 100% of happy path scenarios work
- 90%+ of edge case scenarios handled gracefully
- Clear error messages for users
- No security vulnerabilities found

---

## 🤝 TEAM COORDINATION

### **Communication:**
- Daily updates in lava-ice-logs
- Bug reports in this file (WEEK1-TESTING-PLAN.md)
- Quick questions: Telegram
- Code reviews: GitHub PRs

### **Testing Sessions:**
- **Coordinated Multi-User Test:** Thursday 15:00 CET
  - Ice, Lan, Lava all online
  - Test Scenario 6 together
  - 30-45 minutes estimated

### **Availability:**
- Ice: Daily, flexible hours
- Lan: [Your availability]
- Lava: Support mode, async reviews

---

## 📝 TESTING CHECKLIST

**Before We Start:**
- [ ] Production server running (triologue.duckdns.org)
- [ ] Test user accounts created
- [ ] AI tokens configured
- [ ] Monitoring setup (server logs accessible)

**During Testing:**
- [ ] Document all bugs immediately
- [ ] Take screenshots of errors
- [ ] Save console logs for debugging
- [ ] Note which browser/device for each bug

**After Testing:**
- [ ] All bugs triaged (critical vs. nice-to-have)
- [ ] Critical bugs fixed
- [ ] Medium bugs scheduled or documented
- [ ] Final validation pass completed

---

## 🧊 ICE'S TESTING APPROACH

**Day 1-2: Break It**
- Try to break authentication
- Test all error cases
- Find edge cases
- Document everything

**Day 3-4: Fix It**
- Fix critical bugs immediately
- Improve error handling
- Add missing validations
- Polish UX

**Day 5: Validate It**
- Re-test all scenarios
- Confirm fixes work
- Get team sign-off
- Deploy with confidence

---

## 🌋 LAVA'S ROLE (Support Mode)

**What Ice needs from you:**
- [ ] Code review when bugs are fixed
- [ ] Architecture guidance if needed
- [ ] Security review of auth flow
- [ ] Join multi-user test (Thursday)

**Estimated time:** 5-10 hours across the week

---

## 👨‍💻 LAN'S ROLE (Testing Partner)

**What we need from you:**
- [ ] Run specific test scenarios (marked above)
- [ ] Test on different browsers/devices
- [ ] Join multi-user test (Thursday)
- [ ] Give feedback on UX/errors

**Estimated time:** 3-5 hours across the week

---

## 🎯 END OF WEEK 1 DELIVERABLE

**What we'll have:**
- ✅ Fully tested WebSocket authentication
- ✅ All critical bugs fixed
- ✅ Documented test results
- ✅ Confident production system
- ✅ Clear documentation for future reference

**What we'll know:**
- ✅ WebSocket auth is production-ready
- ✅ Edge cases are handled
- ✅ System is stable for real usage
- ✅ Ready to build more features on top

---

## 🐛 Bug Fixes (Pre-Testing)

### ✅ Feb 16, 19:15 CET - Scrollbar Fix
**Issue:** MessageList not showing scrollbar, couldn't scroll to earlier messages

**Fix:**
- Added `min-h-0` to parent container (prevents flex overflow)
- Added explicit `overflow-y: auto` + inline styles
- Custom scrollbar CSS (Webkit + Firefox) with gray theme
- Mobile touch scrolling support

**Commit:** f9e62b4  
**Status:** Deployed to production ✅

---

**Ready to start testing Tuesday!** 🧪

**Let's make Triologue rock-solid!** 🧊🌋👨‍💻
