import unittest

from generate_compose import (
    generate_compose_config,
    parse_gpu_device_id,
)


class GenerateComposeGpuTests(unittest.TestCase):
    def test_parse_gpu_device_id_default_override_shape(self):
        self.assertEqual(parse_gpu_device_id("2"), 2)

    def test_parse_gpu_device_id_rejects_negative(self):
        with self.assertRaises(Exception):
            parse_gpu_device_id("-1")

    def test_parse_gpu_device_id_rejects_non_integer(self):
        with self.assertRaises(Exception):
            parse_gpu_device_id("2,3")

    def test_generate_compose_config_applies_single_gpu_override_to_both_cameras(self):
        config = generate_compose_config(
            instance_id=0,
            base_port=25590,
            base_rcon_port=25600,
            act_recorder_port=8110,
            coord_port=8120,
            data_dir_base="/tmp/data",
            output_dir="/tmp/output",
            num_episodes=1,
            episode_start_id=0,
            bootstrap_wait_time=60,
            episode_category="look",
            episode_types="all",
            smoke_test=0,
            viewer_rendering_disabled=1,
            world_type="flat",
            render_distance="8",
            simulation_distance="4",
            graphics_mode="1",
            camera_output_alpha_base="/tmp/camera/output_alpha",
            camera_output_bravo_base="/tmp/camera/output_bravo",
            camera_data_alpha_base="/tmp/camera/data_alpha",
            camera_data_bravo_base="/tmp/camera/data_bravo",
            camera_alpha_vnc_base=5901,
            camera_alpha_novnc_base=6901,
            camera_bravo_vnc_base=5902,
            camera_bravo_novnc_base=6902,
            display_base=90,
            vnc_step=2,
            display_step=2,
            gpu_device_id=3,
            gpu_mode="egl",
        )

        alpha_env = config["services"]["camera_alpha_instance_0"]["environment"]
        bravo_env = config["services"]["camera_bravo_instance_0"]["environment"]
        self.assertEqual(alpha_env["NVIDIA_VISIBLE_DEVICES"], 3)
        self.assertEqual(bravo_env["NVIDIA_VISIBLE_DEVICES"], 3)


if __name__ == "__main__":
    unittest.main()
