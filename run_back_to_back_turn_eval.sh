#!/bin/bash

# Defaults
BASE_DATA_DIR="output"
GPU_ID=1

# Parse CLI args
while [[ $# -gt 0 ]]; do
    case $1 in
        --output-dir)
            BASE_DATA_DIR="$2"
            shift 2
            ;;
        --gpu)
            GPU_ID="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "  --output-dir DIR   Base data directory (default: output)"
            echo "  --gpu ID           GPU device ID (default: 1)"
            echo "  -h, --help         Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            echo "Use --help for usage"
            exit 1
            ;;
    esac
done

BASE_DATA_COLLECTION_DIR=$BASE_DATA_DIR/data_collection/eval
EVAL_TIME_SET_DAY=${EVAL_TIME_SET_DAY:-1}
BATCH_NAME=backToBackTurnEval

echo "=========================================="
echo "Running eval: $BATCH_NAME (GPU $GPU_ID)"
echo "=========================================="

BATCH_DIR="$BASE_DATA_COLLECTION_DIR/$BATCH_NAME"
COMPOSE_DIR=$BATCH_DIR/compose_configs

# Temporarily patch generate_compose.py to use the specified GPU
sed -i "s/gpu_device_id = i % gpu_count/gpu_device_id = $GPU_ID/" generate_compose.py

python3 generate_compose.py \
    --compose_dir $COMPOSE_DIR \
    --base_port 25590 \
    --base_rcon_port 25600 \
    --act_recorder_port 8110 \
    --coord_port 8120 \
    --data_dir "$BATCH_DIR/data" \
    --output_dir "$BATCH_DIR/output" \
    --camera_output_alpha_base "$BATCH_DIR/camera/output_alpha" \
    --camera_output_bravo_base "$BATCH_DIR/camera/output_bravo" \
    --camera_data_alpha_base "$BATCH_DIR/camera/data_alpha" \
    --camera_data_bravo_base "$BATCH_DIR/camera/data_bravo" \
    --smoke_test 0 \
    --num_flatland_world 2 \
    --num_normal_world 0 \
    --num_episodes 16 \
    --episode_types $BATCH_NAME \
    --viewer_rendering_disabled 1 \
    --gpu_mode egl \
    --eval_time_set_day $EVAL_TIME_SET_DAY

# Revert the GPU patch
sed -i "s/gpu_device_id = $GPU_ID/gpu_device_id = i % gpu_count/" generate_compose.py

python3 orchestrate.py start --build --compose-dir "$COMPOSE_DIR" --logs-dir "$BATCH_DIR/logs"
python3 orchestrate.py status --compose-dir "$COMPOSE_DIR" --logs-dir "$BATCH_DIR/logs"
python3 orchestrate.py logs --compose-dir "$COMPOSE_DIR" --tail 20 --logs-dir "$BATCH_DIR/logs"
python3 orchestrate.py stop --compose-dir "$COMPOSE_DIR"
# Fix Docker root-owned file permissions so re-runs and postprocessing work
docker run --rm -v "$(pwd)/$BATCH_DIR:/workspace" alpine chown -R "$(id -u):$(id -g)" /workspace
python3 orchestrate.py postprocess --compose-dir "$COMPOSE_DIR" --workers 32 --output-dir "$BATCH_DIR/aligned"

echo ""
echo "Completed eval: $BATCH_NAME"
echo ""

python3 postprocess/prepare_eval_datasets.py --source-dir $BASE_DATA_COLLECTION_DIR --destination-dir $BASE_DATA_DIR/datasets/eval
