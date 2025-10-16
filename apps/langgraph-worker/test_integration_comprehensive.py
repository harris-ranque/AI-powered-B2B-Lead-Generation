#!/usr/bin/env python3
"""
Comprehensive Integration Testing Suite for LangGraph Worker
Tests the entire email generation workflow with detailed logging and visualization
"""
import asyncio
import json
import time
import requests
import subprocess
import signal
import os
import sys
from datetime import datetime
from typing import Dict, Any, List, Optional
from dataclasses import dataclass
from enum import Enum

# Test Data Models
@dataclass
class TestLead:
    id: str
    company_name: str
    contact_name: str
    email: str
    phone: str
    industry: str
    company_size: str
    location: str
    website: str
    description: str

@dataclass
class TestBusinessProfile:
    company_name: str
    industry: str
    value_proposition: str
    services: List[str]
    target_markets: List[str]
    key_differentiators: List[str]
    contact_info: Dict[str, str]

@dataclass
class TestRequirements:
    email_tone: str
    call_to_action: str
    include_case_studies: bool
    personalization_level: str

class TestScenario(Enum):
    HIGH_RELEVANCE = "high_relevance"
    MEDIUM_RELEVANCE = "medium_relevance" 
    LOW_RELEVANCE = "low_relevance"
    ERROR_HANDLING = "error_handling"
    FOLLOW_UP_SEQUENCE = "follow_up_sequence"

class IntegrationTestSuite:
    """Comprehensive integration testing suite with detailed logging"""
    
    def __init__(self, base_url: str = "http://localhost:8080", api_key: str = "test-api-key"):
        self.base_url = base_url
        self.api_key = api_key
        self.server_process = None
        self.test_results = []
        self.start_time = None
        
    def log(self, message: str, level: str = "INFO", step: str = None):
        """Enhanced logging with timestamps and step tracking"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        step_prefix = f"[{step}] " if step else ""
        print(f"{timestamp} | {level:5} | {step_prefix}{message}")
        
    def log_separator(self, title: str):
        """Log a visual separator for test sections"""
        separator = "=" * 80
        print(f"\n{separator}")
        print(f"{title:^80}")
        print(separator)
        
    def start_server(self) -> bool:
        """Start the LangGraph worker server"""
        self.log("Starting LangGraph worker server...", "INFO", "SETUP")
        
        try:
            # Start server in background
            env = os.environ.copy()
            env['PYTHONPATH'] = os.getcwd()
            
            self.server_process = subprocess.Popen(
                ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env
            )
            
            # Wait for server to start
            for attempt in range(30):  # 30 second timeout
                try:
                    response = requests.get(f"{self.base_url}/health", timeout=1)
                    if response.status_code == 200:
                        self.log("✅ Server started successfully", "INFO", "SETUP")
                        return True
                except requests.exceptions.RequestException:
                    time.sleep(1)
                    
            self.log("❌ Server failed to start within 30 seconds", "ERROR", "SETUP")
            return False
            
        except Exception as e:
            self.log(f"❌ Failed to start server: {str(e)}", "ERROR", "SETUP")
            return False
    
    def stop_server(self):
        """Stop the server gracefully"""
        if self.server_process:
            self.log("Stopping server...", "INFO", "CLEANUP")
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=10)
                self.log("✅ Server stopped gracefully", "INFO", "CLEANUP")
            except subprocess.TimeoutExpired:
                self.log("⚠️ Server didn't stop gracefully, forcing...", "WARN", "CLEANUP")
                self.server_process.kill()
                self.server_process.wait()
                
    def get_test_data(self, scenario: TestScenario) -> tuple[TestLead, TestBusinessProfile, TestRequirements]:
        """Get test data for different scenarios"""
        
        # Base business profile (our company)
        business_profile = TestBusinessProfile(
            company_name="Genni AI",
            industry="AI/Technology",
            value_proposition="AI-powered lead generation and email personalization that increases conversion rates by 300%",
            services=["Lead Generation", "Email Automation", "AI Personalization", "Sales Intelligence"],
            target_markets=["B2B SaaS", "Technology Companies", "Professional Services", "E-commerce"],
            key_differentiators=[
                "Multi-agent AI system",
                "Real-time personalization",
                "Scalable automation",
                "Advanced analytics"
            ],
            contact_info={
                "name": "Alex Rivera",
                "email": "contact@genni.ai",
                "phone": "555-GENNI-AI",
                "website": "https://genni.ai",
            }
        )
        
        if scenario == TestScenario.HIGH_RELEVANCE:
            lead = TestLead(
                id="lead-high-001",
                company_name="TechScale Solutions",
                contact_name="Sarah Rodriguez",
                email="sarah.rodriguez@techscale.com",
                phone="555-901-2345",
                industry="B2B SaaS",
                company_size="50-100",
                location="San Francisco, CA",
                website="https://techscale.com",
                description="Fast-growing B2B SaaS company providing project management solutions. Struggling with lead generation and looking to scale their sales process with AI automation."
            )
            requirements = TestRequirements(
                email_tone="professional",
                call_to_action="Schedule a 30-minute demo",
                include_case_studies=True,
                personalization_level="high"
            )
            
        elif scenario == TestScenario.MEDIUM_RELEVANCE:
            lead = TestLead(
                id="lead-medium-002", 
                company_name="Creative Design Studio",
                contact_name="Alex Thompson",
                email="alex@creativedesign.com",
                phone="555-234-5678",
                industry="Creative Services",
                company_size="10-25",
                location="Austin, TX",
                website="https://creativedesign.com",
                description="Boutique design agency serving small to medium businesses. Currently using manual processes for client outreach and interested in automation."
            )
            requirements = TestRequirements(
                email_tone="friendly",
                call_to_action="Learn more about our solutions",
                include_case_studies=False,
                personalization_level="medium"
            )
            
        elif scenario == TestScenario.LOW_RELEVANCE:
            lead = TestLead(
                id="lead-low-003",
                company_name="Local Hardware Store",
                contact_name="Bob Wilson",
                email="bob@localhardware.com",
                phone="555-345-6789",
                industry="Retail",
                company_size="1-5",
                location="Small Town, OH",
                website="https://localhardware.com",
                description="Family-owned hardware store serving the local community for 40 years. Traditional business model with minimal technology adoption."
            )
            requirements = TestRequirements(
                email_tone="casual",
                call_to_action="Contact us for more information",
                include_case_studies=False,
                personalization_level="low"
            )
            
        elif scenario == TestScenario.FOLLOW_UP_SEQUENCE:
            lead = TestLead(
                id="lead-followup-004",
                company_name="Enterprise Corp",
                contact_name="Jennifer Kim",
                email="j.kim@enterprisecorp.com", 
                phone="555-456-7890",
                industry="Enterprise Software",
                company_size="500+",
                location="New York, NY",
                website="https://enterprisecorp.com",
                description="Large enterprise software company with complex sales cycles. Evaluating AI solutions for their sales and marketing teams."
            )
            requirements = TestRequirements(
                email_tone="professional",
                call_to_action="Schedule an enterprise consultation",
                include_case_studies=True,
                personalization_level="high"
            )
            
        else:  # ERROR_HANDLING
            lead = TestLead(
                id="lead-error-005",
                company_name="Test Error Company",
                contact_name="Error Test",
                email="error@test.com",
                phone="555-ERROR",
                industry="Testing",
                company_size="Unknown",
                location="Nowhere",
                website="https://error.com",
                description="This is a test lead designed to trigger error conditions"
            )
            requirements = TestRequirements(
                email_tone="professional",
                call_to_action="Test action",
                include_case_studies=False,
                personalization_level="high"
            )
            
        return lead, business_profile, requirements
    
    def test_health_endpoint(self) -> bool:
        """Test the health endpoint"""
        self.log_separator("HEALTH CHECK TEST")
        
        try:
            self.log("Testing health endpoint...", "INFO", "HEALTH")
            response = requests.get(f"{self.base_url}/health", timeout=10)
            
            if response.status_code == 200:
                health_data = response.json()
                self.log("✅ Health endpoint accessible", "INFO", "HEALTH")
                self.log(f"   Status: {health_data.get('status', 'unknown')}", "INFO", "HEALTH")
                self.log(f"   Services: {health_data.get('services', {})}", "INFO", "HEALTH")
                self.log(f"   Memory: {health_data.get('performance', {}).get('memory_percent', 0)}%", "INFO", "HEALTH")
                return True
            else:
                self.log(f"❌ Health check failed with status {response.status_code}", "ERROR", "HEALTH")
                return False
                
        except Exception as e:
            self.log(f"❌ Health check error: {str(e)}", "ERROR", "HEALTH")
            return False
    
    def test_workflow_info(self) -> bool:
        """Test workflow information endpoints"""
        self.log_separator("WORKFLOW INFO TEST")
        
        try:
            # Test agents info
            self.log("Testing agents info endpoint...", "INFO", "INFO")
            response = requests.get(
                f"{self.base_url}/agents/info",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=10
            )
            
            if response.status_code == 200:
                agents_data = response.json()
                self.log("✅ Agents info retrieved successfully", "INFO", "INFO")
                self.log(f"   Workflow Engine: {agents_data.get('workflow_engine', 'unknown')}", "INFO", "INFO")
                self.log(f"   Agent Count: {len(agents_data.get('agents', []))}", "INFO", "INFO")
                
                for i, agent in enumerate(agents_data.get('agents', []), 1):
                    self.log(f"   Agent {i}: {agent.get('name', 'unknown')} - {agent.get('role', 'unknown')}", "INFO", "INFO")
            else:
                self.log(f"❌ Agents info failed with status {response.status_code}", "ERROR", "INFO")
                return False
                
            # Test workflow engine info
            self.log("Testing workflow engine endpoint...", "INFO", "INFO")
            response = requests.get(
                f"{self.base_url}/workflow-engine",
                headers={"Authorization": f"Bearer {self.api_key}"},
                timeout=10
            )
            
            if response.status_code == 200:
                engine_data = response.json()
                self.log("✅ Workflow engine info retrieved successfully", "INFO", "INFO")
                self.log(f"   Engine: {engine_data.get('name', 'unknown')} v{engine_data.get('version', 'unknown')}", "INFO", "INFO")
                self.log(f"   Status: {engine_data.get('status', 'unknown')}", "INFO", "INFO")
                self.log(f"   Migration Status: {engine_data.get('migration_status', 'unknown')}", "INFO", "INFO")
                return True
            else:
                self.log(f"❌ Workflow engine info failed with status {response.status_code}", "ERROR", "INFO")
                return False
                
        except Exception as e:
            self.log(f"❌ Workflow info error: {str(e)}", "ERROR", "INFO")
            return False
    
    def test_email_generation(self, scenario: TestScenario) -> Dict[str, Any]:
        """Test email generation for a specific scenario"""
        self.log_separator(f"EMAIL GENERATION TEST - {scenario.value.upper()}")
        
        lead, business_profile, requirements = self.get_test_data(scenario)
        
        # Log test data
        self.log(f"Testing scenario: {scenario.value}", "INFO", "TEST")
        self.log(f"Lead: {lead.company_name} ({lead.industry})", "INFO", "TEST")
        self.log(f"Contact: {lead.contact_name} - {lead.email}", "INFO", "TEST")
        self.log(f"Size: {lead.company_size} | Location: {lead.location}", "INFO", "TEST")
        
        request_payload = {
            "request_id": f"test-{scenario.value}-{int(time.time())}",
            "lead": {
                "id": lead.id,
                "company_name": lead.company_name,
                "contact_name": lead.contact_name,
                "email": lead.email,
                "phone": lead.phone,
                "industry": lead.industry,
                "company_size": lead.company_size,
                "location": lead.location,
                "website": lead.website,
                "description": lead.description
            },
            "business_profile": {
                "company_name": business_profile.company_name,
                "industry": business_profile.industry,
                "value_proposition": business_profile.value_proposition,
                "services": business_profile.services,
                "target_markets": business_profile.target_markets,
                "key_differentiators": business_profile.key_differentiators,
                "contact_info": business_profile.contact_info
            },
            "requirements": {
                "email_tone": requirements.email_tone,
                "call_to_action": requirements.call_to_action,
                "include_case_studies": requirements.include_case_studies,
                "personalization_level": requirements.personalization_level
            }
        }
        
        try:
            self.log("🚀 Sending email generation request...", "INFO", "REQUEST")
            start_time = time.time()
            
            response = requests.post(
                f"{self.base_url}/generate-email",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json=request_payload,
                timeout=120  # 2 minute timeout for complex workflows
            )
            
            duration = time.time() - start_time
            self.log(f"⏱️ Request completed in {duration:.2f} seconds", "INFO", "RESPONSE")
            
            if response.status_code == 200:
                result = response.json()
                self.log("✅ Email generation request successful", "INFO", "RESPONSE")
                
                # Log detailed results
                self.log_workflow_results(result, scenario)
                
                return {
                    "scenario": scenario,
                    "success": True,
                    "duration": duration,
                    "status": result.get("status"),
                    "result": result
                }
            else:
                self.log(f"❌ Request failed with status {response.status_code}", "ERROR", "RESPONSE")
                self.log(f"   Response: {response.text}", "ERROR", "RESPONSE")
                return {
                    "scenario": scenario,
                    "success": False,
                    "duration": duration,
                    "error": f"HTTP {response.status_code}: {response.text}"
                }
                
        except Exception as e:
            self.log(f"❌ Request error: {str(e)}", "ERROR", "REQUEST")
            return {
                "scenario": scenario,
                "success": False,
                "duration": 0,
                "error": str(e)
            }
    
    def log_workflow_results(self, result: Dict[str, Any], scenario: TestScenario):
        """Log detailed workflow results"""
        status = result.get("status", "unknown")
        
        if status == "completed":
            self.log("📧 EMAIL GENERATION COMPLETED", "INFO", "RESULT")
            
            workflow_result = result.get("result", {})
            if workflow_result:
                self.log(f"   Request ID: {workflow_result.get('request_id', 'unknown')}", "INFO", "RESULT")
                self.log(f"   Relevance Score: {workflow_result.get('relevance_score', 0):.2f}", "INFO", "RESULT")
                self.log(f"   Processing Time: {workflow_result.get('processing_time', 0):.2f}s", "INFO", "RESULT")
                
                # Log agent results
                agent_results = workflow_result.get("agent_results", [])
                self.log(f"   Agents Executed: {len(agent_results)}", "INFO", "RESULT")
                
                for i, agent in enumerate(agent_results, 1):
                    confidence = agent.get("confidence_score", 0)
                    exec_time = agent.get("execution_time", 0)
                    self.log(f"     {i}. {agent.get('agent_name', 'Unknown')} - Confidence: {confidence:.2f}, Time: {exec_time:.2f}s", "INFO", "RESULT")
                
                # Log pain points and value matches
                pain_points = workflow_result.get("pain_points_identified", [])
                if pain_points:
                    self.log(f"   Pain Points Identified: {len(pain_points)}", "INFO", "RESULT")
                    for i, pain in enumerate(pain_points[:3], 1):  # Show first 3
                        self.log(f"     {i}. {pain}", "INFO", "RESULT")
                
                value_matches = workflow_result.get("value_matches", [])
                if value_matches:
                    self.log(f"   Value Matches: {len(value_matches)}", "INFO", "RESULT")
                    for i, match in enumerate(value_matches[:3], 1):  # Show first 3
                        self.log(f"     {i}. {match}", "INFO", "RESULT")
                
                # Log email content if available
                primary_email = workflow_result.get("primary_email")
                if primary_email:
                    self.log("   📧 EMAIL CONTENT GENERATED:", "INFO", "RESULT")
                    self.log(f"     Subject: {primary_email.get('subject', 'No subject')}", "INFO", "RESULT")
                    body = primary_email.get("body", "No body")
                    # Show first 200 characters of body
                    preview = body[:200] + "..." if len(body) > 200 else body
                    self.log(f"     Body Preview: {preview}", "INFO", "RESULT")
                    self.log(f"     Effectiveness Score: {primary_email.get('estimated_effectiveness', 0):.2f}", "INFO", "RESULT")
                
                # Log recommendations
                recommendations = workflow_result.get("recommendations", [])
                if recommendations:
                    self.log(f"   💡 RECOMMENDATIONS ({len(recommendations)}):", "INFO", "RESULT")
                    for i, rec in enumerate(recommendations[:3], 1):  # Show first 3
                        self.log(f"     {i}. {rec}", "INFO", "RESULT")
            
        elif status == "error":
            self.log("❌ EMAIL GENERATION FAILED", "ERROR", "RESULT")
            self.log(f"   Error: {result.get('error', 'Unknown error')}", "ERROR", "RESULT")
            self.log(f"   Message: {result.get('message', 'No message')}", "ERROR", "RESULT")
        
        else:
            self.log(f"⚠️ UNEXPECTED STATUS: {status}", "WARN", "RESULT")
    
    def test_lead_analysis(self) -> bool:
        """Test the quick lead analysis endpoint"""
        self.log_separator("LEAD ANALYSIS TEST")
        
        lead, _, _ = self.get_test_data(TestScenario.HIGH_RELEVANCE)
        
        payload = {
            "id": lead.id,
            "company_name": lead.company_name,
            "contact_name": lead.contact_name,
            "email": lead.email,
            "phone": lead.phone,
            "industry": lead.industry,
            "company_size": lead.company_size,
            "location": lead.location,
            "website": lead.website,
            "description": lead.description
        }
        
        try:
            self.log("🔍 Testing lead analysis endpoint...", "INFO", "ANALYSIS")
            start_time = time.time()
            
            response = requests.post(
                f"{self.base_url}/analyze-lead",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=60
            )
            
            duration = time.time() - start_time
            
            if response.status_code == 200:
                result = response.json()
                self.log("✅ Lead analysis completed", "INFO", "ANALYSIS")
                self.log(f"   Duration: {duration:.2f}s", "INFO", "ANALYSIS")
                self.log(f"   Relevance Score: {result.get('relevance_score', 0):.2f}", "INFO", "ANALYSIS")
                self.log(f"   Qualification: {result.get('qualification_level', 'unknown')}", "INFO", "ANALYSIS")
                self.log(f"   Assessment: {result.get('fit_assessment', 'no assessment')[:100]}...", "INFO", "ANALYSIS")
                return True
            else:
                self.log(f"❌ Lead analysis failed with status {response.status_code}", "ERROR", "ANALYSIS")
                return False
                
        except Exception as e:
            self.log(f"❌ Lead analysis error: {str(e)}", "ERROR", "ANALYSIS")
            return False
    
    def run_comprehensive_test_suite(self) -> Dict[str, Any]:
        """Run the complete test suite"""
        self.log_separator("COMPREHENSIVE INTEGRATION TEST SUITE")
        self.start_time = time.time()
        
        # Test results summary
        results = {
            "start_time": datetime.now().isoformat(),
            "tests": {},
            "summary": {}
        }
        
        try:
            # 1. Start server
            if not self.start_server():
                self.log("❌ Cannot start server, aborting tests", "ERROR", "SETUP")
                return results
            
            # 2. Health check
            results["tests"]["health"] = self.test_health_endpoint()
            
            # 3. Workflow info
            results["tests"]["workflow_info"] = self.test_workflow_info()
            
            # 4. Lead analysis
            results["tests"]["lead_analysis"] = self.test_lead_analysis()
            
            # 5. Email generation scenarios
            scenarios = [
                TestScenario.HIGH_RELEVANCE,
                TestScenario.MEDIUM_RELEVANCE,
                TestScenario.LOW_RELEVANCE,
                TestScenario.ERROR_HANDLING
            ]
            
            scenario_results = []
            for scenario in scenarios:
                result = self.test_email_generation(scenario)
                scenario_results.append(result)
                results["tests"][f"email_generation_{scenario.value}"] = result["success"]
            
            results["scenario_details"] = scenario_results
            
        except KeyboardInterrupt:
            self.log("🛑 Test suite interrupted by user", "WARN", "MAIN")
        except Exception as e:
            self.log(f"❌ Test suite error: {str(e)}", "ERROR", "MAIN")
        finally:
            self.stop_server()
        
        # Calculate summary
        total_duration = time.time() - self.start_time
        total_tests = len([k for k in results["tests"].keys() if not k.startswith("email_generation")])
        total_tests += len(scenarios)  # Add email generation scenarios
        
        passed_tests = sum(1 for v in results["tests"].values() if v)
        
        results["summary"] = {
            "total_duration": total_duration,
            "total_tests": total_tests,
            "passed_tests": passed_tests,
            "failed_tests": total_tests - passed_tests,
            "success_rate": (passed_tests / total_tests * 100) if total_tests > 0 else 0,
            "end_time": datetime.now().isoformat()
        }
        
        self.log_test_summary(results)
        return results
    
    def log_test_summary(self, results: Dict[str, Any]):
        """Log comprehensive test summary"""
        self.log_separator("TEST SUITE SUMMARY")
        
        summary = results["summary"]
        self.log(f"⏱️ Total Duration: {summary['total_duration']:.2f} seconds", "INFO", "SUMMARY")
        self.log(f"📊 Tests: {summary['passed_tests']}/{summary['total_tests']} passed", "INFO", "SUMMARY")
        self.log(f"📈 Success Rate: {summary['success_rate']:.1f}%", "INFO", "SUMMARY")
        
        # Detailed results
        self.log("\n📋 DETAILED RESULTS:", "INFO", "SUMMARY")
        for test_name, passed in results["tests"].items():
            status = "✅ PASS" if passed else "❌ FAIL"
            self.log(f"   {test_name}: {status}", "INFO", "SUMMARY")
        
        # Scenario details
        if "scenario_details" in results:
            self.log("\n🎭 SCENARIO RESULTS:", "INFO", "SUMMARY")
            for scenario in results["scenario_details"]:
                status = "✅ PASS" if scenario["success"] else "❌ FAIL"
                duration = scenario.get("duration", 0)
                self.log(f"   {scenario['scenario'].value}: {status} ({duration:.2f}s)", "INFO", "SUMMARY")

def main():
    """Main entry point"""
    print("🚀 Starting Comprehensive LangGraph Integration Test Suite")
    print("=" * 80)
    
    # Create and run test suite
    test_suite = IntegrationTestSuite()
    results = test_suite.run_comprehensive_test_suite()
    
    # Save results to file
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"test_results_{timestamp}.json"
    
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    print(f"\n📁 Test results saved to: {results_file}")
    
    # Exit with appropriate code
    success_rate = results["summary"]["success_rate"]
    exit_code = 0 if success_rate >= 80 else 1
    print(f"\n🏁 Test suite completed with exit code: {exit_code}")
    sys.exit(exit_code)

if __name__ == "__main__":
    main()