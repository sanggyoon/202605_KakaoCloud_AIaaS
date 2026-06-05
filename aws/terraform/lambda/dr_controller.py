"""
DR 컨트롤러 — Route53 헬스체크(카카오) 상태를 읽어 앱 ASG의 desired를 0↔N으로 조정.

EventBridge 스케줄(1분)로 호출되며 서울 리전에서 실행된다(크로스리전 불필요).
- 카카오 healthy  → desired = 0   (평상시: AWS 콜드)
- 카카오 unhealthy → desired = N   (DR: AWS 기동)
Route53 헬스체크 자체는 글로벌 신호라, Route53 API로 상태만 읽으면 us-east-1 의존이 없다.
"""
import os
import boto3

route53 = boto3.client("route53")
autoscaling = boto3.client("autoscaling")

HEALTH_CHECK_ID = os.environ["HEALTH_CHECK_ID"]
ASG_NAME = os.environ["ASG_NAME"]
DR_CAPACITY = int(os.environ["DR_CAPACITY"])


def _kakao_healthy() -> bool:
    """Route53 다중 체커 관측의 과반이 성공이면 healthy로 판정."""
    resp = route53.get_health_check_status(HealthCheckId=HEALTH_CHECK_ID)
    observations = resp.get("HealthCheckObservations", [])
    if not observations:
        # 관측이 없으면 판단 보류 → healthy로 간주(불필요한 기동 방지)
        return True
    healthy = sum(
        1
        for o in observations
        if "Success" in o.get("StatusReport", {}).get("Status", "")
    )
    return healthy * 2 >= len(observations)  # 과반


def handler(event, context):
    kakao_up = _kakao_healthy()
    target = 0 if kakao_up else DR_CAPACITY

    groups = autoscaling.describe_auto_scaling_groups(
        AutoScalingGroupNames=[ASG_NAME]
    )["AutoScalingGroups"]
    if not groups:
        print(f"ASG '{ASG_NAME}' not found")
        return
    current = groups[0]["DesiredCapacity"]

    if current == target:
        print(f"noop: kakao_up={kakao_up} desired={current}")
        return

    autoscaling.set_desired_capacity(
        AutoScalingGroupName=ASG_NAME,
        DesiredCapacity=target,
        HonorCooldown=False,
    )
    print(f"DR action: kakao_up={kakao_up} desired {current} -> {target}")
