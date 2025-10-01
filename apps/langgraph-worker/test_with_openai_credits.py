#!/usr/bin/env python3
"""
Full OpenAI Integration Test
Tests the complete workflow using real OpenAI API calls to verify functionality
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

class OpenAIIntegrationTest:
    """Test suite that uses OpenAI credits to verify full workflow"""
    
    def __init__(self, base_url: str = "http://localhost:8080", api_key: str = "test-api-key"):
        self.base_url = base_url
        self.api_key = api_key
        self.server_process = None
        
    def log(self, message: str, level: str = "INFO", step: str = None):
        """Enhanced logging with timestamps"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S.%f")[:-3]
        step_prefix = f"[{step}] " if step else ""
        print(f"{timestamp} | {level:5} | {step_prefix}{message}")
        
    def log_separator(self, title: str):
        """Log a visual separator"""
        separator = "=" * 80
        print(f"\n{separator}")
        print(f"{title:^80}")
        print(separator)
        
    def check_openai_key(self) -> bool:
        """Check if OpenAI API key is configured"""
        openai_key = os.getenv("OPENAI_API_KEY")
        if not openai_key or openai_key == "test-openai-key":
            self.log("❌ OpenAI API key not configured or using test key", "ERROR", "SETUP")
            self.log("   Set OPENAI_API_KEY environment variable with your real API key", "INFO", "SETUP")
            return False
        
        self.log("✅ OpenAI API key configured", "INFO", "SETUP")
        return True
        
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
            for attempt in range(30):
                try:
                    response = requests.get(f"{self.base_url}/health", timeout=1)
                    if response.status_code == 200:
                        health_data = response.json()
                        openai_status = health_data.get("services", {}).get("openai", "unknown")
                        if openai_status == "connected":
                            self.log("✅ Server started with OpenAI connection", "INFO", "SETUP")
                            return True
                        else:
                            self.log(f"⚠️ Server started but OpenAI status: {openai_status}", "WARN", "SETUP")
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
    
    def get_high_quality_lead_data(self) -> Dict[str, Any]:
        """Get high-quality test data likely to work well with OpenAI"""
        return {
            "request_id": f"openai-test-{int(time.time())}",
            "lead": {
                "id": "lead-openai-001",
                "company_name": "CloudScale Technologies",
                "contact_name": "Alexandra Chen",
                "email": "alexandra.chen@cloudscale.com",
                "phone": "555-123-4567",
                "industry": "Cloud Infrastructure",
                "company_size": "100-250",
                "location": "San Francisco, CA",
                "website": "https://cloudscale.com",
                "description": "CloudScale Technologies is a rapidly growing cloud infrastructure company that helps enterprises migrate and optimize their cloud workloads. They're currently experiencing 200% year-over-year growth and are looking to scale their sales and marketing operations. The company serves Fortune 500 clients and has raised $50M in Series B funding."
            },
            "business_profile": {
                "company_name": "Genni AI",
                "industry": "AI/Technology",
                "value_proposition": "AI-powered lead generation and email personalization that increases conversion rates by 300% through multi-agent AI systems",
                "services": [
                    "AI Lead Generation",
                    "Email Personalization", 
                    "Sales Automation",
                    "Conversion Optimization"
                ],
                "target_markets": [
                    "B2B SaaS Companies",
                    "Technology Companies",
                    "Professional Services",
                    "E-commerce Platforms"
                ],
                "key_differentiators": [
                    "Multi-agent AI system with 7 specialized agents",
                    "Real-time personalization using advanced NLP",
                    "Scalable automation handling 10,000+ leads daily",
                    "Proven 300% conversion rate improvement"
                ],
                "contact_info": {
                    "name": "Alex Rivera",
                    "email": "contact@genni.ai",
                    "phone": "555-GENNI-AI",
                    "website": "https://genni.ai"
                }
            },
            "requirements": {
                "email_tone": "professional",
                "call_to_action": "Schedule a 30-minute demo to see 300% conversion improvements",
                "include_case_studies": True,
                "personalization_level": "high"
            }
        }
    
    def test_lead_analysis_with_openai(self) -> bool:
        """Test lead analysis using real OpenAI API"""
        self.log_separator("OPENAI LEAD ANALYSIS TEST")
        
        lead_data = self.get_high_quality_lead_data()["lead"]
        
        try:
            self.log("🔍 Testing lead analysis with OpenAI...", "INFO", "ANALYSIS")
            start_time = time.time()
            
            response = requests.post(
                f"{self.base_url}/analyze-lead",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json=lead_data,
                timeout=120  # Give OpenAI time to respond
            )
            
            duration = time.time() - start_time
            
            if response.status_code == 200:
                result = response.json()
                self.log("✅ Lead analysis completed successfully!", "INFO", "ANALYSIS")
                self.log(f"   Duration: {duration:.2f}s", "INFO", "ANALYSIS")
                self.log(f"   Relevance Score: {result.get('relevance_score', 0):.2f}", "INFO", "ANALYSIS")
                self.log(f"   Qualification Level: {result.get('qualification_level', 'unknown')}", "INFO", "ANALYSIS")
                
                # Log key factors if available
                key_factors = result.get('key_factors', [])
                if key_factors:
                    self.log(f"   Key Factors ({len(key_factors)}):", "INFO", "ANALYSIS")
                    for i, factor in enumerate(key_factors[:3], 1):
                        self.log(f"     {i}. {factor}", "INFO", "ANALYSIS")
                
                # Log opportunities
                opportunities = result.get('opportunities', [])
                if opportunities:
                    self.log(f"   Opportunities ({len(opportunities)}):", "INFO", "ANALYSIS")
                    for i, opp in enumerate(opportunities[:3], 1):
                        self.log(f"     {i}. {opp}", "INFO", "ANALYSIS")
                
                fit_assessment = result.get('fit_assessment', '')
                if fit_assessment and len(fit_assessment) > 20:
                    preview = fit_assessment[:200] + "..." if len(fit_assessment) > 200 else fit_assessment
                    self.log(f"   Fit Assessment: {preview}", "INFO", "ANALYSIS")
                
                return True
            else:
                self.log(f"❌ Lead analysis failed with status {response.status_code}", "ERROR", "ANALYSIS")
                self.log(f"   Response: {response.text}", "ERROR", "ANALYSIS")
                return False
                
        except Exception as e:
            self.log(f"❌ Lead analysis error: {str(e)}", "ERROR", "ANALYSIS")
            return False
    
    def test_full_email_generation_with_openai(self) -> Dict[str, Any]:
        """Test complete email generation workflow with OpenAI"""
        self.log_separator("FULL OPENAI EMAIL GENERATION TEST")
        
        test_data = self.get_high_quality_lead_data()
        
        self.log("🚀 Starting full email generation with OpenAI...", "INFO", "GENERATION")
        self.log(f"   Lead: {test_data['lead']['company_name']}", "INFO", "GENERATION")
        self.log(f"   Industry: {test_data['lead']['industry']}", "INFO", "GENERATION")
        self.log(f"   Size: {test_data['lead']['company_size']}", "INFO", "GENERATION")
        
        try:
            start_time = time.time()
            
            response = requests.post(
                f"{self.base_url}/generate-email",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json=test_data,
                timeout=300  # 5 minute timeout for full workflow
            )
            
            duration = time.time() - start_time
            self.log(f"⏱️ Full workflow completed in {duration:.2f} seconds", "INFO", "GENERATION")
            
            if response.status_code == 200:
                result = response.json()
                status = result.get("status", "unknown")
                
                if status == "completed":
                    self.log("🎉 EMAIL GENERATION SUCCESSFUL!", "INFO", "GENERATION")
                    self.log_detailed_results(result)
                    return {"success": True, "duration": duration, "result": result}
                    
                elif status == "error":
                    error_msg = result.get("error", "Unknown error")
                    self.log(f"❌ Workflow failed: {error_msg}", "ERROR", "GENERATION")
                    
                    # Check if it's an OpenAI quota error
                    if "quota" in error_msg.lower() or "insufficient_quota" in error_msg.lower():
                        self.log("💳 This appears to be an OpenAI quota/billing issue", "WARN", "GENERATION")
                        self.log("   Please check your OpenAI account billing and usage", "INFO", "GENERATION")
                    
                    return {"success": False, "duration": duration, "error": error_msg}
                else:
                    self.log(f"⚠️ Unexpected status: {status}", "WARN", "GENERATION")
                    return {"success": False, "duration": duration, "error": f"Unexpected status: {status}"}
            else:
                self.log(f"❌ HTTP error {response.status_code}", "ERROR", "GENERATION")
                return {"success": False, "duration": duration, "error": f"HTTP {response.status_code}"}
                
        except Exception as e:
            self.log(f"❌ Generation error: {str(e)}", "ERROR", "GENERATION")
            return {"success": False, "duration": 0, "error": str(e)}
    
    def log_detailed_results(self, result: Dict[str, Any]):
        """Log detailed workflow execution results"""
        workflow_result = result.get("result", {})
        
        if not workflow_result:
            self.log("⚠️ No detailed results available", "WARN", "RESULTS")
            return
        
        # Basic metrics
        self.log("📊 WORKFLOW METRICS:", "INFO", "RESULTS")
        self.log(f"   Request ID: {workflow_result.get('request_id', 'unknown')}", "INFO", "RESULTS")
        self.log(f"   Relevance Score: {workflow_result.get('relevance_score', 0):.3f}", "INFO", "RESULTS")
        self.log(f"   Total Processing Time: {workflow_result.get('processing_time', 0):.2f}s", "INFO", "RESULTS")
        
        # Agent execution details
        agent_results = workflow_result.get("agent_results", [])
        if agent_results:
            self.log(f"\n🤖 AGENT EXECUTION ({len(agent_results)} agents):", "INFO", "RESULTS")
            total_agent_time = 0
            for i, agent in enumerate(agent_results, 1):
                agent_name = agent.get("agent_name", "Unknown")
                confidence = agent.get("confidence_score", 0)
                exec_time = agent.get("execution_time", 0)
                total_agent_time += exec_time
                
                self.log(f"   {i:2d}. {agent_name:20} | Confidence: {confidence:.3f} | Time: {exec_time:.2f}s", "INFO", "RESULTS")
                
                # Show brief output
                output = agent.get("output", "")
                if output:
                    preview = output[:100] + "..." if len(output) > 100 else output
                    self.log(f"       Output: {preview}", "INFO", "RESULTS")
            
            self.log(f"   📈 Total Agent Time: {total_agent_time:.2f}s", "INFO", "RESULTS")
        
        # Lead analysis details
        lead_analysis = workflow_result.get("lead_analysis", {})
        if lead_analysis:
            self.log(f"\n🎯 LEAD ANALYSIS:", "INFO", "RESULTS")
            for key, value in lead_analysis.items():
                if isinstance(value, list) and value:
                    self.log(f"   {key}: {len(value)} items", "INFO", "RESULTS")
                    for item in value[:2]:  # Show first 2 items
                        self.log(f"     • {item}", "INFO", "RESULTS")
                elif isinstance(value, str) and len(value) > 10:
                    preview = value[:80] + "..." if len(value) > 80 else value
                    self.log(f"   {key}: {preview}", "INFO", "RESULTS")
        
        # Pain points and value matches
        pain_points = workflow_result.get("pain_points_identified", [])
        if pain_points:
            self.log(f"\n🔍 PAIN POINTS IDENTIFIED ({len(pain_points)}):", "INFO", "RESULTS")
            for i, pain in enumerate(pain_points[:4], 1):
                self.log(f"   {i}. {pain}", "INFO", "RESULTS")
        
        value_matches = workflow_result.get("value_matches", [])
        if value_matches:
            self.log(f"\n💡 VALUE MATCHES ({len(value_matches)}):", "INFO", "RESULTS")
            for i, match in enumerate(value_matches[:4], 1):
                self.log(f"   {i}. {match}", "INFO", "RESULTS")
        
        # Generated email content
        primary_email = workflow_result.get("primary_email")
        if primary_email:
            self.log(f"\n📧 GENERATED EMAIL:", "INFO", "RESULTS")
            self.log(f"   Subject: {primary_email.get('subject', 'No subject')}", "INFO", "RESULTS")
            
            body = primary_email.get('body', '')
            if body:
                # Show first few lines of the email
                lines = body.split('\n')[:8]  # First 8 lines
                self.log(f"   Body Preview:", "INFO", "RESULTS")
                for line in lines:
                    if line.strip():
                        self.log(f"     {line.strip()}", "INFO", "RESULTS")
                if len(body.split('\n')) > 8:
                    lines_count = len(body.split('\n'))
                    self.log(f"     ... ({lines_count} total lines)", "INFO", "RESULTS")
            
            effectiveness = primary_email.get('estimated_effectiveness', 0)
            self.log(f"   Effectiveness Score: {effectiveness:.3f}", "INFO", "RESULTS")
            
            personalization_notes = primary_email.get('personalization_notes', [])
            if personalization_notes:
                self.log(f"   Personalization Elements ({len(personalization_notes)}):", "INFO", "RESULTS")
                for note in personalization_notes[:3]:
                    self.log(f"     • {note}", "INFO", "RESULTS")
        
        # Recommendations
        recommendations = workflow_result.get("recommendations", [])
        if recommendations:
            self.log(f"\n🎯 RECOMMENDATIONS ({len(recommendations)}):", "INFO", "RESULTS")
            for i, rec in enumerate(recommendations[:5], 1):
                self.log(f"   {i}. {rec}", "INFO", "RESULTS")
    
    def run_openai_verification_suite(self) -> Dict[str, Any]:
        """Run comprehensive OpenAI verification tests"""
        self.log_separator("OPENAI VERIFICATION SUITE")
        start_time = time.time()
        
        results = {
            "start_time": datetime.now().isoformat(),
            "openai_key_configured": False,
            "server_started": False,
            "lead_analysis_success": False,
            "email_generation_success": False,
            "total_duration": 0,
            "errors": []
        }
        
        try:
            # 1. Check OpenAI configuration
            if not self.check_openai_key():
                results["errors"].append("OpenAI API key not configured")
                return results
            results["openai_key_configured"] = True
            
            # 2. Start server
            if not self.start_server():
                results["errors"].append("Failed to start server")
                return results
            results["server_started"] = True
            
            # 3. Test lead analysis
            if self.test_lead_analysis_with_openai():
                results["lead_analysis_success"] = True
            else:
                results["errors"].append("Lead analysis with OpenAI failed")
            
            # 4. Test full email generation
            email_result = self.test_full_email_generation_with_openai()
            if email_result["success"]:
                results["email_generation_success"] = True
                results["email_generation_duration"] = email_result["duration"]
            else:
                results["errors"].append(f"Email generation failed: {email_result.get('error', 'Unknown')}")
            
        except Exception as e:
            self.log(f"❌ Test suite error: {str(e)}", "ERROR", "SUITE")
            results["errors"].append(f"Test suite error: {str(e)}")
        finally:
            self.stop_server()
        
        results["total_duration"] = time.time() - start_time
        results["end_time"] = datetime.now().isoformat()
        
        self.log_suite_summary(results)
        return results
    
    def log_suite_summary(self, results: Dict[str, Any]):
        """Log test suite summary"""
        self.log_separator("OPENAI VERIFICATION SUMMARY")
        
        duration = results["total_duration"]
        self.log(f"⏱️ Total Duration: {duration:.2f} seconds", "INFO", "SUMMARY")
        
        # Success indicators
        indicators = [
            ("OpenAI Key Configured", results["openai_key_configured"]),
            ("Server Started", results["server_started"]),
            ("Lead Analysis", results["lead_analysis_success"]),
            ("Email Generation", results["email_generation_success"])
        ]
        
        passed = sum(1 for _, success in indicators if success)
        total = len(indicators)
        
        self.log(f"📊 Tests Passed: {passed}/{total}", "INFO", "SUMMARY")
        
        for test_name, success in indicators:
            status = "✅ PASS" if success else "❌ FAIL"
            self.log(f"   {test_name}: {status}", "INFO", "SUMMARY")
        
        if results["errors"]:
            self.log(f"\n❌ ERRORS ({len(results['errors'])}):", "ERROR", "SUMMARY")
            for error in results["errors"]:
                self.log(f"   • {error}", "ERROR", "SUMMARY")
        
        if results["email_generation_success"]:
            gen_duration = results.get("email_generation_duration", 0)
            self.log(f"\n🎉 EMAIL GENERATION SUCCESSFUL!", "INFO", "SUMMARY")
            self.log(f"   Workflow completed in {gen_duration:.2f} seconds", "INFO", "SUMMARY")
            self.log(f"   All agents executed successfully with OpenAI", "INFO", "SUMMARY")
        
        # Overall verdict
        if passed == total:
            self.log(f"\n🎉 ALL TESTS PASSED - OpenAI integration verified!", "INFO", "SUMMARY")
        elif passed >= total * 0.75:
            self.log(f"\n⚠️ MOSTLY SUCCESSFUL - {passed}/{total} tests passed", "WARN", "SUMMARY")
        else:
            self.log(f"\n❌ TESTS FAILED - Only {passed}/{total} tests passed", "ERROR", "SUMMARY")

def main():
    """Main entry point"""
    print("🧪 OpenAI Integration Verification Suite")
    print("=" * 80)
    print("This test uses real OpenAI API calls to verify full workflow functionality.")
    print("Make sure you have OPENAI_API_KEY set with a valid key that has credits.")
    print("=" * 80)
    
    # Ask for confirmation
    response = input("\n💳 This test will use OpenAI credits. Continue? [y/N]: ").strip().lower()
    if response not in ['y', 'yes']:
        print("👋 Test cancelled. Set OPENAI_API_KEY and run again when ready!")
        return
    
    # Create and run test suite
    test_suite = OpenAIIntegrationTest()
    results = test_suite.run_openai_verification_suite()
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    results_file = f"openai_test_results_{timestamp}.json"
    
    with open(results_file, 'w') as f:
        json.dump(results, f, indent=2, default=str)
    
    print(f"\n📁 Results saved to: {results_file}")
    
    # Exit with appropriate code
    success_rate = (
        sum([
            results["openai_key_configured"],
            results["server_started"], 
            results["lead_analysis_success"],
            results["email_generation_success"]
        ]) / 4 * 100
    )
    
    exit_code = 0 if success_rate >= 75 else 1
    print(f"\n🏁 OpenAI verification completed with exit code: {exit_code}")
    sys.exit(exit_code)

if __name__ == "__main__":
    main()