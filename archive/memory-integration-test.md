# Memory System Integration Test

## Production Readiness Verification

This document outlines comprehensive testing for the organizational memory system to verify production readiness.

## Test Scenarios

### 1. Task Manager Memory Integration
- [ ] Create task in Task Manager
- [ ] Send message mentioning specific code file
- [ ] Verify memory processing occurs automatically
- [ ] Check MemoryPanel displays relevant memories
- [ ] Apply a memory suggestion to draft
- [ ] Verify auto-capture creates new memory
- [ ] Switch between tasks and verify task-specific workspace isolation

### 2. Project Chat Memory Integration  
- [ ] Open Project Chat for a specific group
- [ ] Discuss architectural decision
- [ ] Verify memory processing with project-specific workspace (`project_{group.id}`)
- [ ] Check memory panel shows development-focused suggestions
- [ ] Save important architectural decision as Policy-level memory
- [ ] Verify memory persists and is retrievable in future conversations

### 3. Authentication and Workspace Isolation
- [ ] Test with authenticated user (Clerk JWT)
- [ ] Verify user can only access their own workspaces
- [ ] Test workspace access validation rejects unauthorized access
- [ ] Verify memories are properly scoped to user permissions
- [ ] Test both global and user-specific workspaces

### 4. Memory Management UI
- [ ] Open Memory Management modal
- [ ] Search memories across different importance levels
- [ ] Filter by Remember/TeamRule/Policy
- [ ] Bulk delete memories
- [ ] Create new memory manually
- [ ] Verify real-time statistics update correctly

### 5. Cross-Conversation Persistence
- [ ] Create memory in Task Manager
- [ ] Switch to Project Chat
- [ ] Verify relevant memory appears when discussing related topics
- [ ] Test memory effectiveness scoring
- [ ] Verify authority hierarchy (Policy > TeamRule > Remember)

### 6. API Integration
- [ ] Test `/api/memory/chat/process` endpoint with authentication
- [ ] Verify workspace validation on all memory endpoints
- [ ] Test memory suggestions API
- [ ] Test auto-capture endpoint
- [ ] Verify error handling for unauthorized access

### 7. Performance and Error Handling
- [ ] Test with large number of memories
- [ ] Test memory search performance
- [ ] Verify graceful degradation when memory system unavailable
- [ ] Test real-time memory statistics refresh
- [ ] Verify memory cleanup processes

## Production Configuration

### Environment Variables Required
```bash
# Backend
CLERK_SECRET_KEY=sk_test_...  # For JWT verification
CORTEX_DB_PATH=.cortex/memories.db  # Memory storage

# Frontend  
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...  # For Clerk auth
VITE_CORTEX_API=http://localhost:3001  # API base URL
```

### Memory Workspaces
- `global` - Shared organizational memories
- `default` - Default workspace for unscoped memories
- `user_{user_id}_*` - User-specific workspaces
- `project_{group.id}` - Project-specific memories
- `task_manager_{group.id}` - Task management memories

## Success Criteria

✅ All memory operations require authentication  
✅ Workspace isolation prevents unauthorized access  
✅ Memory intelligence enhances conversations contextually  
✅ UI components provide smooth user experience  
✅ Real-time updates and statistics work correctly  
✅ Memory persistence across conversation contexts  
✅ Performance acceptable with production data volumes  

## Risk Mitigation

1. **Data Privacy**: User memories are isolated by workspace validation
2. **Performance**: Memory search uses efficient indexing and limits
3. **Availability**: Graceful degradation when memory system unavailable  
4. **Scalability**: Memory cleanup processes prevent unbounded growth
5. **Security**: All endpoints require authentication and validate workspace access

## Deployment Checklist

- [ ] Environment variables configured
- [ ] Database initialized with proper schemas
- [ ] Memory system components started successfully
- [ ] Authentication working with production Clerk keys
- [ ] Memory workspaces properly scoped
- [ ] Error monitoring and logging in place
- [ ] Performance monitoring for memory operations
- [ ] Backup strategy for memory data