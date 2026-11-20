
import unittest
from unittest.mock import patch
from simulator import TruckSimulator


class TestRefrigerationStatus(unittest.TestCase):

    def setUp(self):
        self.sim = TruckSimulator(
            "TEST-001",
            "UP-85-TEST",
            "Dairy (Pasteurized Milk & Cream)"
        )
        self.sim.progress_pct = 20.0

    def check_status(self, deviation, expected):
        self.sim.current_temp = self.sim.target_temp + deviation

        with patch("simulator.math.sin", return_value=0), \
             patch("simulator.random.uniform", return_value=0):
            result = self.sim.update_step()

        self.assertEqual(result.refrigeration_status, expected)

    def test_optimal(self):
        self.check_status(1.0, "OPTIMAL")

    def test_warning(self):
        self.check_status(3.0, "WARNING")

    def test_critical(self):
        self.check_status(5.0, "CRITICAL")


if __name__ == "__main__":
    unittest.main()
