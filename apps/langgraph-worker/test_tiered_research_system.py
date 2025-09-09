"""
Comprehensive test suite for the tiered business context research system.
Tests all three tiers (Tavily, Exa, Perplexity) with various scenarios.
"""

import asyncio
import pytest
import time
from unittest.mock import Mock, patch, AsyncMock
from app.utils.research_clients import (
    TavilyClient, 
    ExaClient, 
    PerplexityClient, 
    ResearchOrchestrator,
    ResearchTier,
    ResearchResult
)
from app.langgraph.nodes.business_context_researcher import (
    TieredBusinessContextResearcher,
    broadcast_research_progress
)

class TestTavilyClient:
    """Test Tavily client (Tier 1 - fast basic research)"""
    
    @pytest.mark.asyncio
    async def test_tavily_successful_search(self):
        """Test successful Tavily search with good results"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.tavily_api_key = "test-key"
            
            client = TavilyClient()
            
            # Mock successful API response
            mock_response_data = {
                "results": [
                    {
                        "title": "Acme Corp - Leading Software Solutions",
                        "content": "Acme Corp is a leading provider of enterprise software solutions, specializing in CRM and ERP systems for mid-market companies. Founded in 2010, we serve over 500 customers globally.",
                        "url": "https://acmecorp.com"
                    },
                    {
                        "title": "About Acme Corp",
                        "content": "Our mission is to help businesses streamline their operations through innovative software. We offer cloud-based solutions for sales, marketing, and customer service.",
                        "url": "https://acmecorp.com/about"
                    }
                ],
                "answer": "Acme Corp is a software company that provides CRM and ERP solutions to mid-market businesses."
            }
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_response = AsyncMock()
                mock_response.status = 200
                mock_response.json.return_value = mock_response_data
                mock_post.return_value.__aenter__.return_value = mock_response
                
                result = await client.search("Acme Corp", "acmecorp.com", max_results=5)
                
                # Verify result structure
                assert isinstance(result, ResearchResult)
                assert result.tier == ResearchTier.TAVILY
                assert result.confidence_score > 0.5
                assert result.data_points == 2
                assert result.sources_analyzed == 2
                assert "Acme Corp" in result.company_overview
                assert len(result.services_products) > 0
                assert result.error is None
                assert result.response_time > 0
    
    @pytest.mark.asyncio
    async def test_tavily_api_error(self):
        """Test Tavily API error handling"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.tavily_api_key = "test-key"
            
            client = TavilyClient()
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_response = AsyncMock()
                mock_response.status = 429  # Rate limit error
                mock_post.return_value.__aenter__.return_value = mock_response
                
                result = await client.search("Test Company")
                
                assert result.error is not None
                assert "Tavily API error" in result.error
                assert result.confidence_score == 0.1
    
    @pytest.mark.asyncio
    async def test_tavily_no_api_key(self):
        """Test Tavily with no API key configured"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.tavily_api_key = None
            
            client = TavilyClient()
            result = await client.search("Test Company")
            
            assert result.error == "Tavily API key not configured"
            assert result.confidence_score == 0.0

class TestExaClient:
    """Test Exa client (Tier 2 - semantic search and competitor analysis)"""
    
    @pytest.mark.asyncio
    async def test_exa_deep_search_with_competitors(self):
        """Test Exa deep search with competitor discovery"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.exa_api_key = "test-key"
            
            client = ExaClient()
            
            # Mock competitor discovery response
            mock_competitors_response = {
                "results": [
                    {
                        "title": "Competitor Corp - Enterprise Software",
                        "url": "https://competitor.com",
                        "text": "Competitor Corp provides similar CRM solutions for enterprises",
                        "score": 0.85
                    },
                    {
                        "title": "Rival Inc - Business Management",
                        "url": "https://rival.com", 
                        "text": "Rival Inc offers business management software and consulting",
                        "score": 0.72
                    }
                ]
            }
            
            # Mock industry insights response
            mock_insights_response = {
                "results": [
                    {
                        "text": "The enterprise software market is experiencing rapid growth, with CRM solutions leading the way. Companies are increasingly adopting cloud-based systems."
                    }
                ]
            }
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                # Set up different responses for different endpoints
                def mock_response_factory(*args, **kwargs):
                    mock_response = AsyncMock()
                    mock_response.status = 200
                    
                    # Check URL to return appropriate response
                    if "findSimilar" in str(args) or "findSimilar" in str(kwargs):
                        mock_response.json.return_value = mock_competitors_response
                    else:  # search endpoint
                        mock_response.json.return_value = mock_insights_response
                    
                    return mock_response
                
                mock_post.return_value.__aenter__ = mock_response_factory
                
                result = await client.deep_search("Acme Corp", "acmecorp.com", "Software company")
                
                # Verify result structure
                assert isinstance(result, ResearchResult)
                assert result.tier == ResearchTier.EXA
                assert len(result.competitors) == 2
                assert result.competitors[0]["name"] == "Competitor Corp"
                assert result.competitors[0]["relevance_score"] == 0.85
                assert "enterprise software market" in result.industry_insights.lower()
                assert result.confidence_score > 0.5
    
    @pytest.mark.asyncio
    async def test_exa_no_competitors_found(self):
        """Test Exa when no competitors are found"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.exa_api_key = "test-key"
            
            client = ExaClient()
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_response = AsyncMock()
                mock_response.status = 200
                mock_response.json.return_value = {"results": []}
                mock_post.return_value.__aenter__.return_value = mock_response
                
                result = await client.deep_search("Unknown Corp", "", "")
                
                assert len(result.competitors) == 0
                assert result.industry_insights == ""
                assert result.confidence_score < 0.5

class TestPerplexityClient:
    """Test Perplexity client (Tier 3 - comprehensive reports)"""
    
    @pytest.mark.asyncio
    async def test_perplexity_comprehensive_research(self):
        """Test Perplexity comprehensive research report"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.perplexity_api_key = "test-key"
            
            client = PerplexityClient()
            
            # Mock comprehensive research response
            mock_response_data = {
                "choices": [{
                    "message": {
                        "content": """# Comprehensive Business Intelligence Report: Acme Corp

## Business Model and Revenue Streams
Acme Corp operates as a B2B SaaS provider, generating revenue through subscription-based CRM and ERP solutions. Primary revenue streams include monthly/annual subscriptions, implementation services, and premium support packages.

## Market Position and Competitive Landscape  
Positioned as a mid-market leader in enterprise software, competing with Salesforce, HubSpot, and Microsoft Dynamics. Strong presence in manufacturing and retail sectors.

## Recent Developments
- Q3 2024: Launched AI-powered analytics module
- Secured $50M Series C funding
- Expanded to European markets

## Target Customers and Market Segments
Primary focus on mid-market companies (100-1000 employees) in manufacturing, retail, and professional services sectors.

## Technology Stack and Innovation Focus
Cloud-native architecture built on AWS, React frontend, Python/Django backend. Heavy investment in AI/ML capabilities for predictive analytics.

## Growth Opportunities and Challenges
Key opportunities include international expansion and SMB market penetration. Main challenges include increasing competition and customer acquisition costs."""
                    }
                }],
                "citations": [
                    {"url": "https://acmecorp.com/about", "title": "About Acme Corp"},
                    {"url": "https://techcrunch.com/acme-funding", "title": "Acme Corp raises $50M"},
                    {"url": "https://forbes.com/enterprise-software-trends", "title": "Enterprise Software Trends"}
                ]
            }
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_response = AsyncMock()
                mock_response.status = 200
                mock_response.json.return_value = mock_response_data
                mock_post.return_value.__aenter__.return_value = mock_response
                
                result = await client.comprehensive_research("Acme Corp", "acmecorp.com", "Previous context")
                
                # Verify comprehensive result
                assert isinstance(result, ResearchResult)
                assert result.tier == ResearchTier.PERPLEXITY
                assert result.sources_analyzed == 3  # Number of citations
                assert "Business Model" in result.company_overview
                assert "Salesforce" in result.company_overview  # Competitors mentioned
                assert "AI-powered analytics" in result.company_overview  # Recent developments
                assert result.confidence_score > 0.8  # High confidence for comprehensive report
                assert result.data_points > 10  # Should have many data points
    
    @pytest.mark.asyncio
    async def test_perplexity_api_timeout(self):
        """Test Perplexity API timeout handling"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.perplexity_api_key = "test-key"
            
            client = PerplexityClient()
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_post.side_effect = asyncio.TimeoutError()
                
                result = await client.comprehensive_research("Test Corp")
                
                assert "timeout" in result.error.lower()
                assert result.confidence_score == 0.2

class TestResearchOrchestrator:
    """Test the orchestrator that manages tiered research escalation"""
    
    @pytest.mark.asyncio
    async def test_tier1_sufficient_no_escalation(self):
        """Test when Tier 1 (Tavily) provides sufficient confidence, no escalation"""
        orchestrator = ResearchOrchestrator()
        
        # Mock high-confidence Tavily result
        high_confidence_result = ResearchResult(
            query="Good Corp",
            tier=ResearchTier.TAVILY,
            confidence_score=0.85,  # Above threshold
            data_points=5,
            company_overview="Comprehensive company overview with good data",
            services_products=["CRM", "Analytics", "Support"]
        )
        
        with patch.object(orchestrator.tavily, 'search', return_value=high_confidence_result):
            result = await orchestrator.research_company(
                company_name="Good Corp",
                domain="goodcorp.com",
                user_tier="free"
            )
            
            # Should not escalate beyond Tier 1
            assert result.tier == ResearchTier.TAVILY
            assert result.confidence_score == 0.85
            assert result.escalation_reason is None
    
    @pytest.mark.asyncio
    async def test_tier2_escalation_low_confidence(self):
        """Test escalation to Tier 2 (Exa) when Tier 1 confidence is low"""
        orchestrator = ResearchOrchestrator()
        
        # Mock low-confidence Tavily result
        low_confidence_tavily = ResearchResult(
            query="Sparse Corp",
            tier=ResearchTier.TAVILY,
            confidence_score=0.4,  # Below threshold
            data_points=1,
            company_overview="Limited information available"
        )
        
        # Mock good Exa result
        good_exa_result = ResearchResult(
            query="Sparse Corp",
            tier=ResearchTier.EXA,
            confidence_score=0.7,
            data_points=3,
            competitors=[{"name": "Competitor A", "relevance_score": 0.8}],
            industry_insights="Market analysis shows strong growth potential"
        )
        
        with patch.object(orchestrator.tavily, 'search', return_value=low_confidence_tavily):
            with patch.object(orchestrator.exa, 'deep_search', return_value=good_exa_result):
                result = await orchestrator.research_company(
                    company_name="Sparse Corp",
                    domain="sparsecorp.com",
                    user_tier="pro"
                )
                
                # Should escalate to Tier 2
                assert result.tier == ResearchTier.EXA
                assert len(result.competitors) > 0
                assert "growth potential" in result.industry_insights
                assert result.escalation_reason == "Low confidence (0.40)"
    
    @pytest.mark.asyncio
    async def test_tier3_escalation_premium_user(self):
        """Test escalation to Tier 3 (Perplexity) for premium users with high-value leads"""
        orchestrator = ResearchOrchestrator()
        
        # Mock moderate confidence from previous tiers
        moderate_result = ResearchResult(
            query="Enterprise Corp",
            tier=ResearchTier.EXA,
            confidence_score=0.6,
            data_points=4
        )
        
        # Mock comprehensive Perplexity result
        comprehensive_result = ResearchResult(
            query="Enterprise Corp",
            tier=ResearchTier.PERPLEXITY,
            confidence_score=0.95,
            data_points=20,
            sources_analyzed=10,
            company_overview="Comprehensive analysis with detailed insights...",
            raw_data={"comprehensive_report": "Full detailed report"}
        )
        
        with patch.object(orchestrator.tavily, 'search', return_value=moderate_result):
            with patch.object(orchestrator.exa, 'deep_search', return_value=moderate_result):
                with patch.object(orchestrator.perplexity, 'comprehensive_research', return_value=comprehensive_result):
                    result = await orchestrator.research_company(
                        company_name="Enterprise Corp",
                        domain="enterprisecorp.com",
                        user_tier="enterprise",
                        lead_value=2000.0  # High-value lead
                    )
                    
                    # Should escalate to Tier 3
                    assert result.tier == ResearchTier.PERPLEXITY
                    assert result.confidence_score >= 0.9
                    assert result.sources_analyzed >= 10
                    assert "Full detailed report" in result.raw_data["comprehensive_report"]
    
    @pytest.mark.asyncio
    async def test_forced_tier_override(self):
        """Test forcing a specific research tier (for testing/debugging)"""
        orchestrator = ResearchOrchestrator()
        
        # Mock Exa result
        exa_result = ResearchResult(
            query="Test Corp",
            tier=ResearchTier.EXA,
            confidence_score=0.7,
            competitors=[{"name": "Competitor"}]
        )
        
        with patch.object(orchestrator.exa, 'deep_search', return_value=exa_result):
            result = await orchestrator.research_company(
                company_name="Test Corp",
                force_tier=ResearchTier.EXA
            )
            
            # Should use forced tier, skip Tavily
            assert result.tier == ResearchTier.EXA
            assert len(result.competitors) > 0

class TestTieredBusinessContextResearcher:
    """Test the main business context researcher that integrates with LangGraph"""
    
    @pytest.mark.asyncio
    async def test_research_with_progress_broadcasting(self):
        """Test research with real-time progress broadcasting"""
        researcher = TieredBusinessContextResearcher()
        
        # Mock orchestrator result
        mock_result = ResearchResult(
            query="Progress Corp",
            tier=ResearchTier.TAVILY,
            confidence_score=0.8,
            data_points=5,
            sources_analyzed=3,
            company_overview="Good business context"
        )
        
        with patch.object(researcher.orchestrator, 'research_company', return_value=mock_result):
            with patch('app.langgraph.nodes.business_context_researcher.broadcast_research_progress') as mock_broadcast:
                result = await researcher.research_company_with_progress(
                    company_name="Progress Corp",
                    domain="progresscorp.com",
                    search_id="search_123",
                    user_tier="pro"
                )
                
                # Verify result
                assert result.tier == ResearchTier.TAVILY
                assert result.confidence_score == 0.8
                
                # Verify progress broadcasting was called
                assert mock_broadcast.call_count >= 2  # Start and completion
                
                # Check start broadcast
                start_call = mock_broadcast.call_args_list[0]
                assert start_call[1]["search_id"] == "search_123"
                assert start_call[1]["stage"] == "research_started"
                assert start_call[1]["message"] == "Starting business context research..."
                
                # Check completion broadcast
                completion_call = mock_broadcast.call_args_list[-1]
                assert completion_call[1]["stage"] == "research_completed"
                assert completion_call[1]["tier"] == "tavily"
                assert completion_call[1]["confidence"] == 0.8

class TestProgressBroadcasting:
    """Test the progress broadcasting functionality"""
    
    @pytest.mark.asyncio
    async def test_broadcast_research_progress_success(self):
        """Test successful progress broadcasting to Convex webhook"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.convex_url = "https://test.convex.site"
            mock_settings.return_value.api_key = "test-key"
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_response = AsyncMock()
                mock_response.status = 200
                mock_post.return_value.__aenter__.return_value = mock_response
                
                # Should not raise an exception
                await broadcast_research_progress(
                    search_id="search_123",
                    stage="tier1_tavily",
                    tier="tavily",
                    confidence=0.75,
                    data_points=5,
                    message="Tavily search completed",
                    sourcesAnalyzed=3,
                    escalationReason=None
                )
                
                # Verify webhook was called with correct data
                mock_post.assert_called_once()
                call_args = mock_post.call_args
                
                # Check URL
                assert "webhooks/research/progress" in call_args[1]["json"]["searchId"]
                
                # Check payload
                payload = call_args[1]["json"]
                assert payload["searchId"] == "search_123"
                assert payload["stage"] == "tier1_tavily"
                assert payload["tier"] == "tavily"
                assert payload["confidence"] == 0.75
                assert payload["message"] == "Tavily search completed"
    
    @pytest.mark.asyncio
    async def test_broadcast_research_progress_failure_graceful(self):
        """Test that broadcasting failures don't break research flow"""
        with patch('app.utils.research_clients.get_settings') as mock_settings:
            mock_settings.return_value.convex_url = "https://test.convex.site"
            
            with patch('aiohttp.ClientSession.post') as mock_post:
                mock_post.side_effect = Exception("Network error")
                
                # Should not raise an exception
                await broadcast_research_progress(
                    search_id="search_123",
                    stage="tier1_tavily",
                    tier="tavily",
                    message="Test message"
                )
                
                # Function should complete without error (graceful failure)

# Integration test scenarios
class TestResearchSystemIntegration:
    """Test end-to-end research system scenarios"""
    
    @pytest.mark.asyncio
    async def test_complete_research_flow_standard_path(self):
        """Test complete research flow: Tavily only (standard path)"""
        orchestrator = ResearchOrchestrator()
        
        # High-quality Tavily result (no escalation needed)
        tavily_result = ResearchResult(
            query="StandardCorp",
            tier=ResearchTier.TAVILY,
            confidence_score=0.85,
            data_points=8,
            sources_analyzed=4,
            response_time=2.1,
            company_overview="StandardCorp is a well-established B2B software company specializing in project management tools...",
            services_products=["Project Management", "Team Collaboration", "Time Tracking"],
            data_sources=["https://standardcorp.com", "https://standardcorp.com/about"]
        )
        
        with patch.object(orchestrator.tavily, 'search', return_value=tavily_result):
            result = await orchestrator.research_company("StandardCorp", "standardcorp.com")
            
            assert result.tier == ResearchTier.TAVILY
            assert result.confidence_score >= 0.8
            assert result.response_time < 5  # Fast research
            assert len(result.services_products) > 0
            assert result.escalation_reason is None
    
    @pytest.mark.asyncio 
    async def test_complete_research_flow_escalation_path(self):
        """Test complete research flow: Tavily → Exa escalation"""
        orchestrator = ResearchOrchestrator()
        
        # Sparse Tavily result (triggers escalation)
        sparse_tavily = ResearchResult(
            query="SparseStartup",
            tier=ResearchTier.TAVILY,
            confidence_score=0.3,  # Low confidence
            data_points=1,
            company_overview="Limited information available"
        )
        
        # Rich Exa result (satisfies research needs)
        rich_exa = ResearchResult(
            query="SparseStartup",
            tier=ResearchTier.EXA,
            confidence_score=0.75,
            data_points=6,
            competitors=[
                {"name": "Competitor A", "relevance_score": 0.8},
                {"name": "Competitor B", "relevance_score": 0.6}
            ],
            industry_insights="The startup ecosystem in this sector is highly competitive with rapid innovation cycles..."
        )
        
        with patch.object(orchestrator.tavily, 'search', return_value=sparse_tavily):
            with patch.object(orchestrator.exa, 'deep_search', return_value=rich_exa):
                
                result = await orchestrator.research_company("SparseStartup", "sparsestartup.com")
                
                assert result.tier == ResearchTier.EXA
                assert result.confidence_score >= 0.7
                assert len(result.competitors) == 2
                assert "competitive" in result.industry_insights
                assert result.escalation_reason == "Low confidence (0.30)"
    
    @pytest.mark.asyncio
    async def test_complete_research_flow_premium_path(self):
        """Test complete research flow: Full escalation to Perplexity"""
        orchestrator = ResearchOrchestrator()
        
        # Moderate results from lower tiers
        moderate_tavily = ResearchResult(query="PremiumCorp", tier=ResearchTier.TAVILY, confidence_score=0.5)
        moderate_exa = ResearchResult(query="PremiumCorp", tier=ResearchTier.EXA, confidence_score=0.6)
        
        # Comprehensive Perplexity result
        comprehensive_perplexity = ResearchResult(
            query="PremiumCorp",
            tier=ResearchTier.PERPLEXITY,
            confidence_score=0.95,
            data_points=25,
            sources_analyzed=12,
            response_time=12.3,
            company_overview="[Comprehensive 2000+ word business intelligence report...]",
            raw_data={
                "comprehensive_report": "Detailed market analysis, competitive positioning, financial outlook...",
                "citations": ["source1", "source2", "source3"],
                "word_count": 2150
            }
        )
        
        with patch.object(orchestrator.tavily, 'search', return_value=moderate_tavily):
            with patch.object(orchestrator.exa, 'deep_search', return_value=moderate_exa):
                with patch.object(orchestrator.perplexity, 'comprehensive_research', return_value=comprehensive_perplexity):
                    
                    result = await orchestrator.research_company(
                        company_name="PremiumCorp",
                        domain="premiumcorp.com", 
                        user_tier="enterprise",
                        lead_value=5000.0
                    )
                    
                    assert result.tier == ResearchTier.PERPLEXITY
                    assert result.confidence_score >= 0.9
                    assert result.sources_analyzed >= 10
                    assert result.response_time > 10  # Comprehensive research takes time
                    assert "Detailed market analysis" in result.raw_data["comprehensive_report"]

if __name__ == "__main__":
    """
    Run comprehensive test suite
    Usage: python test_tiered_research_system.py
    """
    
    async def run_all_tests():
        """Run all test scenarios"""
        print("🧪 Running Tiered Business Context Research System Tests")
        print("=" * 60)
        
        # Test individual components
        print("\n🔍 Testing Tavily Client (Tier 1)...")
        tavily_tests = TestTavilyClient()
        await tavily_tests.test_tavily_successful_search()
        await tavily_tests.test_tavily_api_error()
        await tavily_tests.test_tavily_no_api_key()
        print("✅ Tavily tests passed")
        
        print("\n🔬 Testing Exa Client (Tier 2)...")
        exa_tests = TestExaClient()
        await exa_tests.test_exa_deep_search_with_competitors()
        await exa_tests.test_exa_no_competitors_found()
        print("✅ Exa tests passed")
        
        print("\n📄 Testing Perplexity Client (Tier 3)...")
        perplexity_tests = TestPerplexityClient()
        await perplexity_tests.test_perplexity_comprehensive_research()
        await perplexity_tests.test_perplexity_api_timeout()
        print("✅ Perplexity tests passed")
        
        print("\n🎯 Testing Research Orchestrator...")
        orchestrator_tests = TestResearchOrchestrator()
        await orchestrator_tests.test_tier1_sufficient_no_escalation()
        await orchestrator_tests.test_tier2_escalation_low_confidence()
        await orchestrator_tests.test_tier3_escalation_premium_user()
        await orchestrator_tests.test_forced_tier_override()
        print("✅ Orchestrator tests passed")
        
        print("\n📡 Testing Progress Broadcasting...")
        progress_tests = TestProgressBroadcasting()
        await progress_tests.test_broadcast_research_progress_success()
        await progress_tests.test_broadcast_research_progress_failure_graceful()
        print("✅ Progress broadcasting tests passed")
        
        print("\n🔄 Testing Complete Integration Flows...")
        integration_tests = TestResearchSystemIntegration()
        await integration_tests.test_complete_research_flow_standard_path()
        await integration_tests.test_complete_research_flow_escalation_path()
        await integration_tests.test_complete_research_flow_premium_path()
        print("✅ Integration tests passed")
        
        print("\n🎉 All tests completed successfully!")
        print("=" * 60)
        print("✅ Tiered Research System is ready for production")
    
    # Run the tests
    asyncio.run(run_all_tests())