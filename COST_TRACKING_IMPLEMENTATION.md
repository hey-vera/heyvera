# Cost Tracking Infrastructure Implementation

## Overview
Successfully implemented the backend cost tracking infrastructure for Cortex as specified in the plan. The implementation includes database migrations, cost estimation, budget enforcement, and integration with the existing billing system.

## Components Implemented

### 1. Database Migration (v36)
**File:** `crates/api/src/db.rs`
- Updated `SCHEMA_VERSION` from 35 to 36
- Added `migrate_v36()` function with three new tables:
  - `user_budgets`: Daily/weekly/monthly budget limits with notification settings
  - `cost_sessions`: Tracks individual API requests with estimated/actual costs
  - `cost_warnings`: Records budget threshold alerts for users
- Added proper indexes for performance optimization
- Implemented CRUD methods for all new data structures

### 2. Cost Estimator Module
**File:** `crates/api/src/cost_estimator.rs`
- `CostEstimator` struct with comprehensive pricing logic
- Model-aware pricing for Claude, OpenAI, and Gemini
- Cache discount calculation (Claude 90% off, OpenAI 50% off)
- Token estimation heuristics (4 chars ≈ 1 token)
- BYOK vs BYOS cost type detection
- Request cost breakdown with detailed analytics

**Key Methods:**
- `estimate_request_cost()`: Pre-request cost estimation
- `calculate_actual_cost()`: Post-request cost calculation
- `estimate_tokens_from_text()`: Text-to-token conversion heuristics
- `get_cost_type()`: Determines if cost tracking applies (BYOK only)

### 3. Budget Enforcer Module
**File:** `crates/api/src/budget_enforcer.rs`
- `BudgetEnforcer` struct for real-time budget checking
- Daily/weekly/monthly spending calculation
- Warning threshold detection (default 80%)
- Cost session lifecycle management
- Integration with existing billing gate system

**Key Methods:**
- `check_budget_before_request()`: Pre-request budget validation
- `start_cost_session()`: Begin tracking a request
- `finalize_cost_session()`: Complete tracking with actual costs
- `get_spending_history()`: 30-day spending trends for charts

### 4. Database Integration
**File:** `crates/api/src/db.rs`
- Added data structures: `UserBudget`, `CostSession`, `CostWarning`
- Implemented comprehensive CRUD operations:
  - `get_user_budget()`: Retrieves/creates default budget settings
  - `update_user_budget()`: Updates budget preferences
  - `create_cost_session()`: Start tracking a request
  - `update_cost_session()`: Finalize with actual costs
  - `get_user_cost_breakdown()`: Separate BYOK/BYOS spending
  - `record_cost_warning()`: Log budget threshold alerts
  - `get_user_cost_warnings()`: Retrieve recent warnings
  - `acknowledge_cost_warning()`: Mark warnings as seen

### 5. Module Registration
**File:** `crates/api/src/lib.rs`
- Registered `cost_estimator` and `budget_enforcer` as public modules
- Available for integration throughout the codebase

## Database Schema

### user_budgets
```sql
CREATE TABLE user_budgets (
    user_id TEXT PRIMARY KEY,
    daily_budget REAL NOT NULL DEFAULT 5.0,
    weekly_budget REAL NOT NULL DEFAULT 25.0,
    monthly_budget REAL NOT NULL DEFAULT 100.0,
    notifications_enabled INTEGER NOT NULL DEFAULT 1,
    warning_threshold REAL NOT NULL DEFAULT 0.8,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### cost_sessions
```sql
CREATE TABLE cost_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    cost_type TEXT NOT NULL CHECK (cost_type IN ('byok', 'byos')),
    session_start INTEGER NOT NULL,
    session_end INTEGER,
    estimated_cost REAL NOT NULL DEFAULT 0.0,
    actual_cost REAL,
    tokens_in INTEGER NOT NULL DEFAULT 0,
    tokens_out INTEGER NOT NULL DEFAULT 0,
    model TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

### cost_warnings
```sql
CREATE TABLE cost_warnings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    warning_type TEXT NOT NULL CHECK (warning_type IN ('daily', 'weekly', 'monthly')),
    threshold_percent REAL NOT NULL,
    current_cost REAL NOT NULL,
    budget_limit REAL NOT NULL,
    triggered_at INTEGER NOT NULL DEFAULT (unixepoch()),
    acknowledged_at INTEGER
);
```

## Key Features

### Budget Management
- Default budgets: $5 daily, $25 weekly, $100 monthly
- Configurable warning thresholds (default 80%)
- Separate tracking for BYOK (API key) vs BYOS (subscription) costs
- Only BYOK costs count against budget limits

### Cost Estimation
- Model-specific pricing rates based on current provider APIs
- Cache-aware cost calculation with provider-specific discounts
- Heuristic token estimation for pre-request planning
- Actual vs estimated cost tracking for accuracy improvement

### Real-time Budget Enforcement
- Pre-request budget validation
- Hard limits prevent overspending
- Threshold warnings before limits are reached
- Cost session tracking for detailed analytics

### Integration Points
- Compatible with existing `billing.rs` gate system
- Uses existing `usage.rs` estimation functions
- Extends current database patterns and conventions
- Ready for frontend budget management UI integration

## Testing
- Comprehensive unit tests for all modules
- Integration tests verify database operations
- Mock data generation for development/testing

## Next Steps for Integration
1. Add API endpoints for budget management (`GET/POST /api/budget`)
2. Integrate budget checking into LLM request pipeline
3. Add frontend components for budget visualization
4. Set up cost tracking in chat/run execution flows
5. Implement notification system for budget warnings

The infrastructure is now ready for full integration with Cortex's request pipeline and frontend interfaces.