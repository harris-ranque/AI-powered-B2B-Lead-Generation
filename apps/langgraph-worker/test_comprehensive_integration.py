#!/usr/bin/env python3
"""
Comprehensive Integration Testing Suite for Genni LangGraph Worker
Tests the complete email generation pipeline with realistic dummy leads and scenarios.
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
from typing import Dict, Any, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import uuid

# Test Data Models
@dataclass
class TestLead:
    """Realistic test lead data covering various business scenarios"""
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
    pain_points: List[str]
    expected_relevance: float  # Expected relevance score for validation

@dataclass
class TestBusinessProfile:
    """Our business profile for personalization context"""
    company_name: str
    industry: str
    value_proposition: str
    services: List[str]
    target_markets: List[str]
    key_differentiators: List[str]
    contact_info: Dict[str, str]

@dataclass
class TestRequirements:
    """Email generation requirements"""
    tone: str
    call_to_action: str
    include_case_study: bool
    personalization_level: str

class TestScenario(Enum):
    """Different test scenarios covering various lead quality levels"""
    HIGH_RELEVANCE_SAAS = "high_relevance_saas"
    MEDIUM_RELEVANCE_TRADITIONAL = "medium_relevance_traditional"
    LOW_RELEVANCE_DIFFERENT_INDUSTRY = "low_relevance_different_industry"
    EDGE_CASE_LIMITED_DATA = "edge_case_limited_data"
    ERROR_HANDLING = "error_handling"

class ComprehensiveTestSuite:
    """
    Comprehensive integration testing suite with realistic scenarios and detailed validation
    """

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

    def get_test_leads(self) -> Dict[TestScenario, TestLead]:
        """Generate realistic test leads covering various scenarios"""
        return {
            TestScenario.HIGH_RELEVANCE_SAAS: TestLead(
                id="lead_001_high_saas",
                company_name="TechFlow Solutions",
                contact_name="Sarah Chen",
                email="sarah.chen@techflowsolutions.com",
                phone="+1-555-0123",
                industry="SaaS Software",
                company_size="50-100 employees",
                location="San Francisco, CA",
                website="https://techflowsolutions.com",
                description="B2B SaaS platform for workflow automation and team collaboration. Serves mid-market companies struggling with manual processes and disconnected tools.",
                pain_points=[
                    "Manual lead qualification processes taking 2-3 hours per prospect",
                    "Sales team spending 40% of time on administrative tasks",
                    "Inconsistent email outreach with low response rates",
                    "Difficulty scaling personalized communication"
                ],
                expected_relevance=0.92
            ),

            TestScenario.MEDIUM_RELEVANCE_TRADITIONAL: TestLead(
                id="lead_002_medium_traditional",
                company_name="Mountain Manufacturing Co",
                contact_name="Robert Johnson",
                email="rjohnson@mountainmfg.com",
                phone="+1-555-0456",
                industry="Manufacturing",
                company_size="200-500 employees",
                location="Denver, CO",
                website="https://mountainmfg.com",
                description="Traditional manufacturing company producing industrial equipment. Looking to modernize operations and improve efficiency.",
                pain_points=[
                    "Outdated inventory management systems",
                    "Manual quality control processes",
                    "Limited digital marketing presence",
                    "Inefficient customer communication"
                ],
                expected_relevance=0.68
            ),

            TestScenario.LOW_RELEVANCE_DIFFERENT_INDUSTRY: TestLead(
                id="lead_003_low_healthcare",
                company_name="Downtown Medical Center",
                contact_name="Dr. Lisa Martinez",
                email="l.martinez@downtownmedical.org",
                phone="+1-555-0789",
                industry="Healthcare",
                company_size="1000+ employees",
                location="Chicago, IL",
                website="https://downtownmedical.org",
                description="Large medical center focusing on patient care and medical research. Primarily concerned with healthcare delivery and compliance.",
                pain_points=[
                    "Patient scheduling inefficiencies",
                    "Medical record management",
                    "Regulatory compliance complexity",
                    "Staff coordination challenges"
                ],
                expected_relevance=0.25
            ),

            TestScenario.EDGE_CASE_LIMITED_DATA: TestLead(
                id="lead_004_edge_limited",
                company_name="Local Coffee Roastery",
                contact_name="Mike Thompson",
                email="mike@localcoffee.com",
                phone="+1-555-0321",
                industry="Food & Beverage",
                company_size="5-10 employees",
                location="Portland, OR",
                website="https://localcoffee.com",
                description="Small local business with minimal online presence.",
                pain_points=[
                    "Limited online visibility",
                    "Manual inventory tracking"
                ],
                expected_relevance=0.15
            ),

            TestScenario.ERROR_HANDLING: TestLead(
                id="lead_005_error_test",
                company_name="Invalid Company Name !@#$%",
                contact_name="",
                email="invalid-email",
                phone="not-a-phone-number",
                industry="",
                company_size="unknown",
                location="Invalid Location 123!@#",
                website="not-a-website",
                description="",
                pain_points=[],
                expected_relevance=0.0
            )
        }

    def get_test_business_profile(self) -> TestBusinessProfile:
        """Get our business profile for testing personalization"""
        return TestBusinessProfile(
            company_name="Genni",
            industry="AI-Powered Business Services",
            value_proposition="AI-powered lead generation and email personalization that converts prospects into customers through intelligent outreach",
            services=[
                "Lead Discovery & Qualification",
                "AI-Powered Email Personalization",
                "Automated Outreach Sequences",
                "Sales Process Optimization",
                "CRM Integration"
            ],
            target_markets=[
                "B2B SaaS Companies",
                "Sales Teams",
                "Marketing Agencies",
                "Professional Services",
                "Growing Businesses"
            ],
            key_differentiators=[
                "3-agent AI system for superior personalization",
                "Real-time lead qualification and scoring",
                "Industry-specific messaging optimization",
                "Comprehensive business intelligence integration",
                "95%+ email deliverability rates"
            ],
            contact_info={
                "email": "hello@genni.com",
                "website": "https://genni.com",
                "phone": "+1-555-GENNI-AI"
            }
        )

    def get_test_requirements(self) -> TestRequirements:
        """Get test email requirements"""
        return TestRequirements(
            tone="professional",
            call_to_action="Schedule a 15-minute demo to see how Genni can 10x your lead conversion",
            include_case_study=True,
            personalization_level="high"
        )

    def start_server(self) -> bool:
        """Start the LangGraph worker server for testing"""
        self.log("Starting LangGraph worker server...", "INFO", "SETUP")

        # When running in mock test mode, use FastAPI's TestClient instead of spawning uvicorn
        try:
            # Start server in background
            env = os.environ.copy()
            env['PYTHONPATH'] = os.getcwd()

            self.server_process = subprocess.Popen(
                ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                cwd=os.path.dirname(os.path.abspath(__file__))
            )

            # Wait for server to start
            for attempt in range(30):  # 30 second timeout
                try:
                    response = requests.get(f"{self.base_url}/health", timeout=2)
                    if response.status_code == 200:
                        self.log(f"Server started successfully after {attempt + 1} attempts", "SUCCESS", "SETUP")
                        return True
                except requests.exceptions.RequestException:
                    pass
                time.sleep(1)

            self.log("Server failed to start within timeout", "ERROR", "SETUP")
            return False

        except Exception as e:
            self.log(f"Failed to start server: {e}", "ERROR", "SETUP")
            return False

    def stop_server(self):
        """Stop the test server"""
        if self.server_process:
            self.log("Stopping test server...", "INFO", "CLEANUP")
            self.server_process.terminate()
            try:
                self.server_process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.server_process.kill()
                self.server_process.wait()
            self.server_process = None

    async def test_email_generation(self, scenario: TestScenario, lead: TestLead) -> Dict[str, Any]:
        """Test complete email generation workflow for a specific scenario"""
        self.log(f"Testing email generation for {scenario.value}", "INFO", "TEST")

        start_time = time.time()

        # Prepare request payload
        request_payload = {
            "requestId": f"test_{scenario.value}_{int(time.time())}",
            "lead": {
                "id": lead.id,
                "company": lead.company_name,
                "name": lead.contact_name,
                "industry": lead.industry,
                "company_size": lead.company_size,
                "location": lead.location,
                "description": lead.description,
                "websiteUrl": lead.website,
                "contactInfo": {
                    "email": lead.email,
                    "phone": lead.phone
                },
                "pain_points": lead.pain_points
            },
            "businessProfile": {
                "companyName": self.get_test_business_profile().company_name,
                "industry": self.get_test_business_profile().industry,
                "valueProposition": self.get_test_business_profile().value_proposition,
                "services": self.get_test_business_profile().services,
                "targetMarkets": self.get_test_business_profile().target_markets,
                "keyDifferentiators": self.get_test_business_profile().key_differentiators,
                "contact_info": self.get_test_business_profile().contact_info
            },
            "requirements": {
                "tone": self.get_test_requirements().tone,
                "callToAction": self.get_test_requirements().call_to_action,
                "includeCaseStudy": self.get_test_requirements().include_case_study,
                "personalization_level": self.get_test_requirements().personalization_level
            }
        }

        try:
            # Make API request
            response = requests.post(
                f"{self.base_url}/generate-email",
                json=request_payload,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                timeout=120  # 2 minute timeout for AI processing
            )

            processing_time = time.time() - start_time

            # Parse response
            if response.status_code == 200:
                result = response.json()
                return self.validate_email_generation_result(scenario, lead, result, processing_time)
            else:
                error_result = {
                    "scenario": scenario.value,
                    "lead_company": lead.company_name,
                    "success": False,
                    "error": f"HTTP {response.status_code}: {response.text}",
                    "processing_time": processing_time
                }
                self.log(f"API Error for {scenario.value}: {error_result['error']}", "ERROR", "TEST")
                return error_result

        except Exception as e:
            processing_time = time.time() - start_time
            error_result = {
                "scenario": scenario.value,
                "lead_company": lead.company_name,
                "success": False,
                "error": str(e),
                "processing_time": processing_time
            }
            self.log(f"Exception for {scenario.value}: {str(e)}", "ERROR", "TEST")
            return error_result

    def validate_email_generation_result(self, scenario: TestScenario, lead: TestLead, result: Dict[str, Any], processing_time: float) -> Dict[str, Any]:
        """Validate email generation result and extract insights"""
        validation_result = {
            "scenario": scenario.value,
            "lead_company": lead.company_name,
            "processing_time": processing_time,
            "success": False,
            "validations": {},
            "insights": {},
            "email_content": {},
            "recommendations": []
        }

        try:
            # Basic structure validation
            if result.get("status") == "completed" and "result" in result:
                validation_result["success"] = True
                email_result = result["result"]

                # Extract key metrics
                relevance_score = email_result.get("relevance_score", 0)
                pain_points = email_result.get("pain_points_identified", [])
                value_matches = email_result.get("value_matches", [])
                primary_email = email_result.get("primary_email", {})

                # Store email content for manual review
                validation_result["email_content"] = {
                    "subject": primary_email.get("subject", ""),
                    "body": primary_email.get("body", ""),
                    "personalization_notes": primary_email.get("personalization_notes", []),
                    "estimated_effectiveness": primary_email.get("estimated_effectiveness", 0)
                }

                # Relevance score validation
                expected_relevance = lead.expected_relevance
                relevance_diff = abs(relevance_score - expected_relevance)
                validation_result["validations"]["relevance_score"] = {
                    "actual": relevance_score,
                    "expected": expected_relevance,
                    "difference": relevance_diff,
                    "within_tolerance": relevance_diff <= 0.2,  # 20% tolerance
                    "status": "PASS" if relevance_diff <= 0.2 else "FAIL"
                }

                # Pain point detection validation
                validation_result["validations"]["pain_point_detection"] = {
                    "identified_count": len(pain_points),
                    "expected_pain_points": lead.pain_points,
                    "identified_pain_points": pain_points,
                    "detection_quality": "GOOD" if len(pain_points) >= 2 else "POOR"
                }

                # Value matching validation
                validation_result["validations"]["value_matching"] = {
                    "value_matches_count": len(value_matches),
                    "value_matches": value_matches,
                    "matching_quality": "GOOD" if len(value_matches) >= 2 else "POOR"
                }

                # Email quality validation
                email_subject = primary_email.get("subject", "")
                email_body = primary_email.get("body", "")
                validation_result["validations"]["email_quality"] = {
                    "has_subject": bool(email_subject),
                    "has_body": bool(email_body),
                    "subject_length": len(email_subject),
                    "body_length": len(email_body),
                    "includes_company_name": lead.company_name.lower() in email_body.lower(),
                    "includes_personalization": len(primary_email.get("personalization_notes", [])) > 0,
                    "estimated_effectiveness": primary_email.get("estimated_effectiveness", 0)
                }

                # Processing time validation
                validation_result["validations"]["performance"] = {
                    "processing_time": processing_time,
                    "within_target": processing_time <= 45.0,  # 45 second target
                    "performance_grade": self.get_performance_grade(processing_time)
                }

                # Generate insights
                validation_result["insights"] = {
                    "relevance_accuracy": "High" if relevance_diff <= 0.1 else "Medium" if relevance_diff <= 0.2 else "Low",
                    "personalization_depth": len(primary_email.get("personalization_notes", [])),
                    "business_context_usage": self.analyze_business_context_usage(email_body, self.get_test_business_profile()),
                    "competitive_differentiation": self.analyze_competitive_differentiation(email_body, self.get_test_business_profile().key_differentiators)
                }

                # Generate recommendations
                if relevance_diff > 0.2:
                    validation_result["recommendations"].append(f"Relevance score accuracy needs improvement (off by {relevance_diff:.2f})")
                if len(pain_points) < 2:
                    validation_result["recommendations"].append("Pain point detection could be enhanced")
                if processing_time > 45:
                    validation_result["recommendations"].append(f"Processing time too slow ({processing_time:.1f}s)")
                if primary_email.get("estimated_effectiveness", 0) < 0.7:
                    validation_result["recommendations"].append("Email effectiveness score is below target")

            else:
                validation_result["error"] = result.get("error", "Unknown error")
                validation_result["message"] = result.get("message", "No message provided")

        except Exception as e:
            validation_result["error"] = f"Validation error: {str(e)}"
            validation_result["success"] = False

        return validation_result

    def get_performance_grade(self, processing_time: float) -> str:
        """Get performance grade based on processing time"""
        if processing_time <= 25:
            return "A+ (Excellent)"
        elif processing_time <= 35:
            return "A (Good)"
        elif processing_time <= 45:
            return "B (Acceptable)"
        elif processing_time <= 60:
            return "C (Slow)"
        else:
            return "D (Too Slow)"

    def analyze_business_context_usage(self, email_body: str, business_profile: TestBusinessProfile) -> Dict[str, Any]:
        """Analyze how well business context is used in the email"""
        email_lower = email_body.lower()

        services_mentioned = [service for service in business_profile.services
                            if any(word in email_lower for word in service.lower().split())]

        differentiators_mentioned = [diff for diff in business_profile.key_differentiators
                                   if any(word in email_lower for word in diff.lower().split())]

        return {
            "services_mentioned": services_mentioned,
            "differentiators_mentioned": differentiators_mentioned,
            "value_prop_referenced": business_profile.value_proposition.lower()[:20] in email_lower,
            "context_usage_score": (len(services_mentioned) + len(differentiators_mentioned)) / 5.0
        }

    def analyze_competitive_differentiation(self, email_body: str, differentiators: List[str]) -> Dict[str, Any]:
        """Analyze competitive differentiation in the email"""
        email_lower = email_body.lower()

        mentioned_differentiators = []
        for diff in differentiators:
            if any(word in email_lower for word in diff.lower().split()):
                mentioned_differentiators.append(diff)

        return {
            "differentiators_used": mentioned_differentiators,
            "differentiation_score": len(mentioned_differentiators) / len(differentiators),
            "competitive_positioning": len(mentioned_differentiators) >= 2
        }

    def display_test_result(self, result: Dict[str, Any]):
        """Display comprehensive test result"""
        scenario = result["scenario"]
        company = result["lead_company"]

        print(f"\n📊 TEST RESULT: {scenario.upper()}")
        print(f"Company: {company}")
        print(f"Overall Success: {'✅ PASS' if result['success'] else '❌ FAIL'}")
        print(f"Processing Time: {result['processing_time']:.2f}s")

        if result["success"]:
            # Validation results
            validations = result.get("validations", {})

            if "relevance_score" in validations:
                rel_val = validations["relevance_score"]
                print(f"Relevance Score: {rel_val['actual']:.2f} (expected: {rel_val['expected']:.2f}) - {rel_val['status']}")

            if "performance" in validations:
                perf_val = validations["performance"]
                print(f"Performance: {perf_val['performance_grade']}")

            # Email content summary
            email_content = result.get("email_content", {})
            if email_content:
                print(f"\n📧 GENERATED EMAIL:")
                print(f"Subject: {email_content.get('subject', 'N/A')}")
                print(f"Body Length: {len(email_content.get('body', ''))} characters")
                print(f"Personalization Notes: {len(email_content.get('personalization_notes', []))}")
                print(f"Effectiveness Score: {email_content.get('estimated_effectiveness', 0):.2f}")

                # Show first 200 characters of email body
                body = email_content.get('body', '')
                if body:
                    print(f"\nEmail Preview:")
                    print(f"{'='*50}")
                    print(body[:200] + "..." if len(body) > 200 else body)
                    print(f"{'='*50}")

            # Insights
            insights = result.get("insights", {})
            if insights:
                print(f"\n💡 INSIGHTS:")
                for key, value in insights.items():
                    print(f"  {key}: {value}")

            # Recommendations
            recommendations = result.get("recommendations", [])
            if recommendations:
                print(f"\n🔧 RECOMMENDATIONS:")
                for rec in recommendations:
                    print(f"  • {rec}")
        else:
            print(f"❌ Error: {result.get('error', 'Unknown error')}")

    def generate_test_report(self, all_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Generate comprehensive test report"""
        total_tests = len(all_results)
        successful_tests = len([r for r in all_results if r["success"]])

        # Calculate average processing time for successful tests
        successful_results = [r for r in all_results if r["success"]]
        avg_processing_time = sum(r["processing_time"] for r in successful_results) / len(successful_results) if successful_results else 0

        # Analyze relevance score accuracy
        relevance_accuracies = []
        for result in successful_results:
            if "validations" in result and "relevance_score" in result["validations"]:
                rel_val = result["validations"]["relevance_score"]
                relevance_accuracies.append(rel_val["difference"])

        avg_relevance_accuracy = sum(relevance_accuracies) / len(relevance_accuracies) if relevance_accuracies else 0

        report = {
            "test_summary": {
                "total_tests": total_tests,
                "successful_tests": successful_tests,
                "success_rate": successful_tests / total_tests if total_tests > 0 else 0,
                "average_processing_time": avg_processing_time,
                "average_relevance_accuracy": avg_relevance_accuracy
            },
            "performance_analysis": {
                "fastest_test": min(r["processing_time"] for r in successful_results) if successful_results else 0,
                "slowest_test": max(r["processing_time"] for r in successful_results) if successful_results else 0,
                "tests_within_target": len([r for r in successful_results if r["processing_time"] <= 45])
            },
            "quality_analysis": {
                "high_relevance_accuracy": len([acc for acc in relevance_accuracies if acc <= 0.1]),
                "medium_relevance_accuracy": len([acc for acc in relevance_accuracies if 0.1 < acc <= 0.2]),
                "low_relevance_accuracy": len([acc for acc in relevance_accuracies if acc > 0.2])
            },
            "detailed_results": all_results
        }

        return report

    def display_final_report(self, report: Dict[str, Any]):
        """Display final test report"""
        self.log_separator("COMPREHENSIVE TEST REPORT")

        summary = report["test_summary"]
        print(f"Total Tests: {summary['total_tests']}")
        print(f"Successful Tests: {summary['successful_tests']}")
        print(f"Success Rate: {summary['success_rate']:.1%}")
        print(f"Average Processing Time: {summary['average_processing_time']:.2f}s")
        print(f"Average Relevance Accuracy: ±{summary['average_relevance_accuracy']:.2f}")

        performance = report["performance_analysis"]
        print(f"\n⚡ PERFORMANCE ANALYSIS:")
        print(f"Fastest Test: {performance['fastest_test']:.2f}s")
        print(f"Slowest Test: {performance['slowest_test']:.2f}s")
        print(f"Tests Within Target (45s): {performance['tests_within_target']}/{summary['successful_tests']}")

        quality = report["quality_analysis"]
        print(f"\n🎯 QUALITY ANALYSIS:")
        print(f"High Accuracy (±0.1): {quality['high_relevance_accuracy']}")
        print(f"Medium Accuracy (±0.2): {quality['medium_relevance_accuracy']}")
        print(f"Low Accuracy (>0.2): {quality['low_relevance_accuracy']}")

        # Overall assessment
        overall_grade = self.calculate_overall_grade(report)
        print(f"\n🏆 OVERALL GRADE: {overall_grade}")

        print(f"\n📁 Test completed at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        # Save detailed report
        report_filename = f"test_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(report_filename, 'w') as f:
            json.dump(report, f, indent=2, default=str)
        print(f"📄 Detailed report saved to: {report_filename}")

    def calculate_overall_grade(self, report: Dict[str, Any]) -> str:
        """Calculate overall test grade"""
        summary = report["test_summary"]
        performance = report["performance_analysis"]
        quality = report["quality_analysis"]

        # Grade calculation
        success_score = summary["success_rate"] * 40  # 40% weight
        performance_score = (performance["tests_within_target"] / summary["successful_tests"]) * 30 if summary["successful_tests"] > 0 else 0  # 30% weight
        quality_score = (quality["high_relevance_accuracy"] / len(report["detailed_results"])) * 30 if report["detailed_results"] else 0  # 30% weight

        total_score = success_score + performance_score + quality_score

        if total_score >= 90:
            return "A+ (Excellent)"
        elif total_score >= 80:
            return "A (Good)"
        elif total_score >= 70:
            return "B (Acceptable)"
        elif total_score >= 60:
            return "C (Needs Improvement)"
        else:
            return "D (Poor)"

    async def run_comprehensive_tests(self):
        """Run comprehensive integration tests"""
        self.log_separator("GENNI LANGGRAPH COMPREHENSIVE TESTING SUITE")
        self.start_time = datetime.now()

        # Start server
        if not self.start_server():
            self.log("Failed to start server, aborting tests", "ERROR")
            return

        try:
            # Get test data
            test_leads = self.get_test_leads()
            all_results = []

            # Run tests for each scenario
            for scenario, lead in test_leads.items():
                self.log_separator(f"TESTING SCENARIO: {scenario.value.upper()}")

                result = await self.test_email_generation(scenario, lead)
                all_results.append(result)
                self.display_test_result(result)

                # Add delay between tests to avoid overwhelming the system
                time.sleep(2)

            # Generate and display final report
            report = self.generate_test_report(all_results)
            self.display_final_report(report)

        finally:
            self.stop_server()

def main():
    """Main entry point"""
    # Check if server is already running
    try:
        response = requests.get("http://localhost:8080/health", timeout=2)
        if response.status_code == 200:
            print("✅ Server already running, using existing instance")
            suite = ComprehensiveTestSuite()
            suite.server_process = None  # Don't manage server lifecycle
        else:
            suite = ComprehensiveTestSuite()
    except:
        suite = ComprehensiveTestSuite()

    # Run tests
    asyncio.run(suite.run_comprehensive_tests())

if __name__ == "__main__":
    main()
