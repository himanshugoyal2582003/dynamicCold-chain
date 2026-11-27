import unittest

import main as aiml_main
from lstm_engine import lstm_engine
from models import InsurancePricingRequest


class TestColdChainAIML(unittest.TestCase):
    def test_health_endpoint(self):
        data = aiml_main.health_check()
        self.assertEqual(data["status"], "healthy")
        self.assertIn("spoilage_lstm_loaded", data)
        self.assertIn("insurance_lstm_loaded", data)

    def test_service_token_enforcement(self):
        orig_token = aiml_main.SERVICE_TOKEN
        orig_prod = aiml_main.IS_PRODUCTION
        try:
            aiml_main.SERVICE_TOKEN = "super_secret_test_token_123"
            aiml_main.IS_PRODUCTION = True

            self.assertFalse(aiml_main.has_valid_service_token(None))
            self.assertFalse(aiml_main.has_valid_service_token("wrong"))
            self.assertTrue(aiml_main.has_valid_service_token("super_secret_test_token_123"))

            aiml_main.SERVICE_TOKEN = ""
            self.assertFalse(aiml_main.has_valid_service_token(None))
        finally:
            aiml_main.SERVICE_TOKEN = orig_token
            aiml_main.IS_PRODUCTION = orig_prod

    def test_spoilage_and_insurance_inference(self):
        sp = lstm_engine.predict_spoilage(
            truck_key="unit-test-truck",
            product_type="Dairy",
            temperature=3.8,
            target_temp=3.5,
            humidity=68.0,
            door_open=False,
            speed_kmh=50.0,
        )
        self.assertGreaterEqual(sp["spoilage_risk"], 0.0)
        self.assertLessEqual(sp["spoilage_risk"], 1.0)
        self.assertIn(sp["spoilage_risk_level"], ["LOW", "MODERATE", "HIGH", "CRITICAL"])

        req = InsurancePricingRequest(
            truck_id="unit-test-truck",
            base_price=450.0,
            trip_count=5,
            incident_count=0,
            temp_excursion_count=0,
            avg_temp_deviation=0.2,
            door_open_incidents=0,
            months_in_service=6,
        )
        ins = aiml_main.predict_insurance_pricing(req)
        self.assertGreater(ins.current_price, 0)
        self.assertGreaterEqual(ins.risk_score, 5.0)
        self.assertLessEqual(ins.risk_score, 95.0)


if __name__ == "__main__":
    unittest.main()
