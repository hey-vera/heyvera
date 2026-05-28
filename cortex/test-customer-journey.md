# External Customer Journey Test Plan

## Overview

This document outlines the complete external customer onboarding and project setup flow for Cortex. These tests validate that new customers can successfully create and manage projects from initial signup to productive use.

## Pre-requisites

- Cortex is deployed and accessible at cortex.heyvera.org
- Clerk authentication is configured
- Backend project API endpoints are implemented
- Frontend builds successfully

## Test Scenarios

### 1. New Customer Signup and Onboarding

**Objective**: Verify that a new customer can sign up and complete the onboarding flow.

**Steps**:
1. Navigate to cortex.heyvera.org
2. Click "Sign In" or visit the app directly
3. Complete Clerk signup with email/password
4. Verify onboarding flow appears with 4 steps:
   - Welcome (introduces Cortex features)
   - Connect Provider (AI subscription setup)
   - Create Project (project template selection)
   - First Task (natural language commands)
5. Complete or skip each step
6. Verify redirect to main Cortex interface

**Expected Results**:
- Smooth signup process with clear instructions
- Onboarding explains key features and value proposition
- User understands how to connect AI providers
- User sees project creation options
- User learns about task management
- Main interface loads with appropriate first-time user guidance

### 2. Project Creation Flow

**Objective**: Verify that customers can create new projects from templates.

**Steps**:
1. After onboarding, navigate to Projects section
2. Click "New Project" button
3. Verify Project Setup Wizard opens
4. Test each step of the wizard:
   - **Template Selection**: Choose from web app, API service, full-stack, mobile, or blank
   - **Project Details**: Enter name and description, verify name validation
   - **Import Source**: Select "Create New" (template-based)
   - **Review**: Confirm all details are correct
5. Click "Create Project"
6. Verify project creation success and redirect to project dashboard

**Expected Results**:
- Clear template options with descriptions and estimated time
- Real-time name validation with helpful error messages
- Intuitive wizard flow with progress indication
- Successful project creation with immediate access

### 3. Project Import Flow

**Objective**: Verify that customers can import existing projects from GitHub.

**Steps**:
1. From Projects list, click "Import" button
2. Verify Import Modal opens with source options
3. Select "GitHub" as import source
4. Enter project details:
   - Project name (test validation)
   - Description
   - GitHub repository URL
   - Branch (optional)
5. Click "Import Project"
6. Verify import process and redirect to project dashboard

**Expected Results**:
- Clear import options with visual indicators
- GitHub URL validation and helpful error messages
- Import process feedback with loading states
- Successful import with project files accessible

### 4. Project Dashboard and Management

**Objective**: Verify that customers can view and manage their projects.

**Steps**:
1. From project dashboard, verify all sections display correctly:
   - Project stats (files, tasks, commits, collaborators)
   - Quick actions (Open Chat, Open Workspace, View Code, Sync Git)
   - Recent activity feed
   - Project files tree
2. Test project actions:
   - Click "Open Chat" → should open project-specific chat
   - Click "Open Workspace" → should open external workspace URL
   - Test file tree navigation and folder expansion
3. Return to Projects list and test:
   - Search functionality
   - Status filtering
   - Project menu actions (pause, archive, delete)
   - Sync with Git (for imported projects)

**Expected Results**:
- Comprehensive project overview with accurate statistics
- Functional quick actions that work as expected
- Intuitive file browsing experience
- Robust project management features

### 5. Integration with Task Management

**Objective**: Verify that projects integrate well with Cortex's task management features.

**Steps**:
1. From project dashboard, click "Open Chat"
2. Verify project context is available in chat
3. Create tasks related to the project:
   - "Create task: Set up authentication for this project"
   - "Create task: Add unit tests to the login component"
4. Verify tasks appear in task manager
5. Launch task in Project Chat and verify context

**Expected Results**:
- Project context carries through to chat interface
- Tasks can be created with project-specific context
- Task manager shows project-related tasks appropriately
- Project files and context are available to AI agents

### 6. Provider Setup and Project Work

**Objective**: Verify that customers can connect AI providers and use them for project work.

**Steps**:
1. Go to Settings → Providers
2. Verify provider connection UI for Claude and OpenAI
3. Connect at least one provider (if credentials available)
4. Return to project and start a chat session
5. Test project-specific commands:
   - "Analyze the structure of this project"
   - "Help me set up a new React component"
   - "Review the security of this authentication flow"
6. Verify AI responses are contextually appropriate

**Expected Results**:
- Clear provider setup instructions
- Successful provider connection with feedback
- AI agents understand project context
- Responses are relevant to the project's codebase and stack

## Success Criteria

A successful test run should demonstrate:

✅ **Smooth Onboarding**: New customers understand Cortex's value and can complete setup quickly  
✅ **Intuitive Project Creation**: Multiple paths to create/import projects with good UX  
✅ **Comprehensive Project Management**: Full lifecycle from creation to active development  
✅ **Seamless Integration**: Projects work well with tasks, chat, and AI agents  
✅ **Professional Experience**: No rough edges, clear error handling, polished interface  

## Issues to Watch For

- **Authentication Problems**: Clerk integration issues or session management
- **API Failures**: Backend endpoints not implemented or returning errors
- **UX Confusion**: Unclear navigation, missing guidance, or confusing workflows
- **Integration Gaps**: Projects not connecting properly with tasks or chat
- **Performance Issues**: Slow loading, unresponsive UI, or poor mobile experience

## Implementation Notes

The project creation and import flow includes:

- **ProjectSetupWizard.tsx**: Multi-step wizard for creating new projects
- **ProjectImportModal.tsx**: Modal for importing from GitHub or uploading files
- **ProjectsList.tsx**: Main projects listing with search, filters, and management
- **ProjectDashboard.tsx**: Detailed project view with stats and actions
- **ProjectsView.tsx**: Router component that manages project UI flows
- **projectApi.ts**: API layer for project operations

Key features implemented:
- Template-based project creation with 5 built-in templates
- GitHub repository import with branch selection
- Real-time project name validation
- Project management with status tracking
- File tree browsing and workspace integration
- Integration with existing task management system
- Professional onboarding flow with project setup step

## Manual Testing Checklist

Before release, manually verify:

- [ ] New user signup and onboarding completes successfully
- [ ] All project templates create projects correctly
- [ ] GitHub import works with public repositories
- [ ] Project dashboard loads and displays accurate information
- [ ] Quick actions work (chat, workspace, file browsing)
- [ ] Project management features work (pause, archive, delete)
- [ ] Projects integrate with existing task management
- [ ] Provider setup flows into project work seamlessly
- [ ] Error handling is graceful with helpful messages
- [ ] Mobile/responsive design works across screen sizes
- [ ] Performance is acceptable on slower connections

## Automated Testing

Consider implementing automated tests for:
- Project creation API endpoints
- Frontend component rendering and interactions
- Authentication and authorization flows
- Data persistence and retrieval
- Integration between projects and tasks

This comprehensive test plan ensures that external customers have a polished, professional experience when using Cortex for project management and AI-assisted development.